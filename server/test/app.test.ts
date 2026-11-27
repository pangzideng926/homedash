import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { parseConfig, type AppConfig } from '../src/config.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'super-secret-password-123';
const TEST_SESSION_SECRET = '0123456789abcdef0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error('响应头中缺少 Set-Cookie');
  }
  const firstSegment = setCookieHeader.split(';')[0];
  if (!firstSegment) {
    throw new Error('Set-Cookie 格式无效');
  }
  return firstSegment;
}

describe('密码哈希与配置校验', () => {
  it('使用 scrypt 生成并校验密码哈希', async () => {
    const hashed = await hashPassword(TEST_PASSWORD);
    expect(hashed).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword(TEST_PASSWORD, hashed)).toBe(true);
    expect(await verifyPassword('wrong-password', hashed)).toBe(false);
    expect(await verifyPassword(TEST_PASSWORD, 'invalid-format')).toBe(false);
  });

  it('校验环境变量配置默认值与 SESSION_SECRET 长度', () => {
    const prodConfig = parseConfig({
      NODE_ENV: 'production',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: 'scrypt$aa$bb',
      SESSION_SECRET: TEST_SESSION_SECRET,
    });
    expect(prodConfig.PORT).toBe(3000);
    expect(prodConfig.HOST).toBe('0.0.0.0');
    expect(prodConfig.COOKIE_SECURE).toBe(true);

    const overrideConfig = parseConfig({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'false',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: 'scrypt$aa$bb',
      SESSION_SECRET: TEST_SESSION_SECRET,
    });
    expect(overrideConfig.COOKIE_SECURE).toBe(false);

    expect(() =>
      parseConfig({
        ADMIN_USERNAME: TEST_USERNAME,
        ADMIN_PASSWORD_HASH: 'scrypt$aa$bb',
        SESSION_SECRET: 'too-short',
      }),
    ).toThrow();
  });
});

describe('认证与接口路由', () => {
  let database: DatabaseConnection;
  let config: AppConfig;

  beforeEach(async () => {
    const passwordHash = await hashPassword(TEST_PASSWORD);
    config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
    });
    database = createDatabase(config.DATABASE_URL);
  });

  afterEach(() => {
    database.close();
  });

  it('GET /api/health 无需登录并返回 status: ok', async () => {
    const app = createApp(config, database.db);
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('未登录访问 /api/auth/me 与其他受保护接口均返回 401', async () => {
    const app = createApp(config, database.db);

    const meRes = await app.request('/api/auth/me');
    expect(meRes.status).toBe(401);

    const otherRes = await app.request('/api/dashboard/summary');
    expect(otherRes.status).toBe(401);
  });

  it('错误密码或错误用户名登录返回 401', async () => {
    const app = createApp(config, database.db);

    const wrongPwdRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong-password' }),
    });
    expect(wrongPwdRes.status).toBe(401);
    expect(await wrongPwdRes.json()).toEqual({ error: '用户名或密码错误' });

    const wrongUserRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'other', password: TEST_PASSWORD }),
    });
    expect(wrongUserRes.status).toBe(401);
    expect(await wrongUserRes.json()).toEqual({ error: '用户名或密码错误' });
  });

  it('登录成功设置签名 Cookie，/api/auth/me 返回用户名，登出后被拒', async () => {
    const app = createApp(config, database.db);

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });

    expect(loginRes.status).toBe(200);
    expect(await loginRes.json()).toEqual({ ok: true });

    const setCookie = loginRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const cookiePair = extractCookiePair(setCookie);

    const meRes = await app.request('/api/auth/me', {
      headers: { Cookie: cookiePair },
    });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ username: TEST_USERNAME });

    const tamperedRes = await app.request('/api/auth/me', {
      headers: { Cookie: `${cookiePair}tampered` },
    });
    expect(tamperedRes.status).toBe(401);

    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookiePair },
    });
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });

    const afterLogoutRes = await app.request('/api/auth/me', {
      headers: { Cookie: cookiePair },
    });
    expect(afterLogoutRes.status).toBe(401);
  });

  it('生产环境托管静态资源且非 /api 路径回退到 index.html', async () => {
    const tmpDistDir = path.join(TEST_DIR, '.tmp-web-dist');
    fs.mkdirSync(path.join(tmpDistDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDistDir, 'index.html'),
      '<!doctype html><html><body>SPA</body></html>',
    );
    fs.writeFileSync(path.join(tmpDistDir, 'assets', 'app.js'), 'console.log("ok");');

    try {
      const prodConfig: AppConfig = {
        ...config,
        NODE_ENV: 'production',
        WEB_DIST_DIR: tmpDistDir,
      };
      const app = createApp(prodConfig, database.db);

      const assetRes = await app.request('/assets/app.js');
      expect(assetRes.status).toBe(200);
      expect(await assetRes.text()).toBe('console.log("ok");');

      const spaRes = await app.request('/settings/nas');
      expect(spaRes.status).toBe(200);
      expect(await spaRes.text()).toContain('SPA');

      const apiRes = await app.request('/api/health');
      expect(apiRes.status).toBe(200);
      expect(await apiRes.json()).toEqual({ status: 'ok' });
    } finally {
      fs.rmSync(tmpDistDir, { recursive: true, force: true });
    }
  });
});
