import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig, SERVER_ROOT } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  createMediaImageProxy,
  IMAGE_CACHE_CONTROL_HEADER,
  MAX_IMAGE_BYTES,
} from '../src/media/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  return setCookieHeader?.split(';')[0] ?? '';
}

describe('海报安全代理（签名校验、白名单、重定向、大小限制、改写与缓存）', () => {
  let database: DatabaseConnection;
  let passwordHash: string;
  const createdTempDirs: string[] = [];

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
    for (const dir of createdTempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    createdTempDirs.length = 0;
  });

  function createRepoTempDir(prefix: string): string {
    const dir = path.join(
      SERVER_ROOT,
      'data',
      `.tmp-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    createdTempDirs.push(dir);
    return dir;
  }

  async function loginAdmin(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    return extractCookiePair(res.headers.get('set-cookie'));
  }

  it('未登录返回 401，签名校验失败返回 403', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
    });
    const fetchMock = vi.fn<typeof fetch>();
    const app = createApp(config, database.db, {
      fetchFn: fetchMock,
      mediaImageCacheDir: null,
    });

    const proxy = createMediaImageProxy(config, { cacheDir: null });
    const token = proxy.createTokenForUrl('https://image.tmdb.org/t/p/w500/poster.jpg')!;
    expect(token).toBeTruthy();

    // 未登录
    const unauthRes = await app.request(`/api/media/image/${token}`);
    expect(unauthRes.status).toBe(401);

    // 登录后篡改签名
    const cookie = await loginAdmin(app);
    const [payload, sig] = token.split('.');
    const tamperedSig = `${sig!.slice(0, -2)}AA`;
    const tamperedRes = await app.request(`/api/media/image/${payload}.${tamperedSig}`, {
      headers: { Cookie: cookie },
    });
    expect(tamperedRes.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('丢弃 MP 自身路径、/api/v1/system/img、相对路径与非白名单主机，并改写 TMDB original->w342', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      MEDIA_IMAGE_HOSTS: 'img.custom.example.com',
    });

    const proxy = createMediaImageProxy(config, {
      mpBaseUrl: 'https://mp.example.com',
      cacheDir: null,
    });

    expect(proxy.toProxyUrl('/api/v1/system/img?path=/a.jpg')).toBeNull();
    expect(proxy.toProxyUrl('https://mp.example.com/api/v1/system/img?id=1')).toBeNull();
    expect(proxy.toProxyUrl('https://mp.example.com/static/poster.jpg')).toBeNull();
    expect(proxy.toProxyUrl('http://image.tmdb.org/t/p/w500/a.jpg')).toBeNull();
    expect(proxy.toProxyUrl('https://evil.example.com/a.jpg')).toBeNull();
    expect(proxy.toProxyUrl('https://evil-doubanio.com/a.jpg')).toBeNull();

    // 合法白名单与 TMDB original -> w342 改写
    const tmdbProxyUrl = proxy.toProxyUrl('https://image.tmdb.org/t/p/original/abc123.jpg');
    expect(tmdbProxyUrl).toMatch(/^\/api\/media\/image\//);
    const tmdbToken = tmdbProxyUrl!.replace('/api/media/image/', '');
    const decoded = Buffer.from(tmdbToken.split('.')[0]!, 'base64url').toString('utf-8');
    expect(decoded).toBe('https://image.tmdb.org/t/p/w342/abc123.jpg');

    // 豆瓣子域与自定义 MEDIA_IMAGE_HOSTS 均放行
    expect(proxy.toProxyUrl('https://img1.doubanio.com/view/photo/s.jpg')).toMatch(
      /^\/api\/media\/image\//,
    );
    expect(proxy.toProxyUrl('https://img.custom.example.com/poster.png')).toMatch(
      /^\/api\/media\/image\//,
    );

    // 即使直接对未白名单地址签名也应被拒绝（403）
    const signedEvil = proxy.signRawUrlForTest('https://evil.example.com/a.jpg');
    const evilFetch = await proxy.fetchImageByToken(signedEvil);
    expect(evilFetch).toEqual({
      ok: false,
      status: 403,
      error: '图片来源不在允许的白名单内',
    });
  });

  it('豆瓣图片请求携带 Referer 与浏览器 UA；拦截重定向到非白名单、非 image/* 及超 5MB 响应', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe('manual');
      expect(headers.get('X-API-KEY')).toBeNull();

      if (url === 'https://img1.doubanio.com/ok.jpg') {
        expect(headers.get('Referer')).toBe('https://movie.douban.com/');
        expect(headers.get('User-Agent')).toContain('Mozilla/');
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg; charset=utf-8' },
        });
      }

      if (url === 'https://image.tmdb.org/t/p/w342/redirect-evil.jpg') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example.com/leak.jpg' },
        });
      }

      if (url === 'https://image.tmdb.org/t/p/w342/not-image.jpg') {
        return new Response('<html>not image</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }

      if (url === 'https://image.tmdb.org/t/p/w342/too-large-header.jpg') {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(MAX_IMAGE_BYTES + 1),
          },
        });
      }

      if (url === 'https://image.tmdb.org/t/p/w342/too-large-stream.jpg') {
        const bigChunk = new Uint8Array(MAX_IMAGE_BYTES + 128);
        return new Response(bigChunk, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, {
      fetchFn: fetchMock,
      mediaImageCacheDir: null,
    });
    const cookie = await loginAdmin(app);
    const proxy = createMediaImageProxy(config, { fetchFn: fetchMock, cacheDir: null });

    const doubanRes = await app.request(proxy.toProxyUrl('https://img1.doubanio.com/ok.jpg')!, {
      headers: { Cookie: cookie },
    });
    expect(doubanRes.status).toBe(200);
    expect(doubanRes.headers.get('Content-Type')).toBe('image/jpeg');
    expect(doubanRes.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL_HEADER);

    const redirectEvilRes = await app.request(
      proxy.toProxyUrl('https://image.tmdb.org/t/p/original/redirect-evil.jpg')!,
      { headers: { Cookie: cookie } },
    );
    expect(redirectEvilRes.status).toBe(403);

    const notImageRes = await app.request(
      proxy.toProxyUrl('https://image.tmdb.org/t/p/w342/not-image.jpg')!,
      { headers: { Cookie: cookie } },
    );
    expect(notImageRes.status).toBe(415);

    const tooLargeHeaderRes = await app.request(
      proxy.toProxyUrl('https://image.tmdb.org/t/p/w342/too-large-header.jpg')!,
      { headers: { Cookie: cookie } },
    );
    expect(tooLargeHeaderRes.status).toBe(413);

    const tooLargeStreamRes = await app.request(
      proxy.toProxyUrl('https://image.tmdb.org/t/p/w342/too-large-stream.jpg')!,
      { headers: { Cookie: cookie } },
    );
    expect(tooLargeStreamRes.status).toBe(413);
  });

  it('支持内存 LRU 命中、淘汰以及按 URL sha256 命中的磁盘缓存', async () => {
    const cacheDir = createRepoTempDir('img-cache');
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      MEDIA_IMAGE_CACHE_DIR: cacheDir,
      MEDIA_IMAGE_CACHE_MAX: '1',
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      return new Response(Buffer.from(`img:${url}`), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      });
    });

    const proxy1 = createMediaImageProxy(config, { fetchFn: fetchMock });
    const urlA = 'https://image.tmdb.org/t/p/w342/a.webp';
    const urlB = 'https://image.tmdb.org/t/p/w342/b.webp';
    const tokenA = proxy1.createTokenForUrl(urlA)!;
    const tokenB = proxy1.createTokenForUrl(urlB)!;

    // 首次拉取 A（miss）-> 第二次命中内存 LRU（不触发 fetch）
    const r1 = await proxy1.fetchImageByToken(tokenA);
    expect(r1).toMatchObject({ ok: true, cacheHit: 'miss', contentType: 'image/webp' });
    const r2 = await proxy1.fetchImageByToken(tokenA);
    expect(r2).toMatchObject({ ok: true, cacheHit: 'memory' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 验证磁盘文件以 sha256(urlA) 命名
    const expectedHashA = createHash('sha256').update(urlA, 'utf-8').digest('hex');
    expect(fs.existsSync(path.join(cacheDir, expectedHashA))).toBe(true);

    // 写入 B 淘汰内存 LRU（max=1），随后新建无内存缓存的实例应命中磁盘缓存
    await proxy1.fetchImageByToken(tokenB);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const proxy2 = createMediaImageProxy(config, { fetchFn: fetchMock });
    const diskRes = await proxy2.fetchImageByToken(tokenA);
    expect(diskRes).toMatchObject({ ok: true, cacheHit: 'disk', contentType: 'image/webp' });
    if (diskRes.ok) {
      expect(diskRes.body.toString('utf-8')).toBe(`img:${urlA}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
