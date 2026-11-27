import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  assertQbitRequestAllowed,
  buildQbitSummaryData,
  createQbitClient,
  extractSessionCookieFromHeaders,
  extractTrackerDomain,
  QBIT_ALLOWED_GET_PATHS,
  QbitClientError,
  type QbitSummaryResponse,
} from '../src/qbittorrent/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  return setCookieHeader?.split(';')[0] ?? '';
}

describe('qBittorrent 白名单断言与聚合逻辑', () => {
  it('严格限制只读路径白名单，拒绝 trackers 单查询与任何写接口', () => {
    for (const allowedPath of QBIT_ALLOWED_GET_PATHS) {
      expect(() => assertQbitRequestAllowed('GET', allowedPath)).not.toThrow();
    }
    expect(() => assertQbitRequestAllowed('POST', '/api/v2/auth/login')).not.toThrow();

    const forbiddenRequests: Array<[string, string]> = [
      ['GET', '/api/v2/torrents/trackers'],
      ['POST', '/api/v2/torrents/pause'],
      ['POST', '/api/v2/torrents/resume'],
      ['POST', '/api/v2/torrents/stop'],
      ['POST', '/api/v2/torrents/start'],
      ['POST', '/api/v2/torrents/delete'],
      ['POST', '/api/v2/torrents/add'],
      ['POST', '/api/v2/app/setPreferences'],
    ];
    for (const [method, apiPath] of forbiddenRequests) {
      expect(() => assertQbitRequestAllowed(method, apiPath)).toThrow(QbitClientError);
    }
  });

  it('提取规范化 Tracker 域名、聚合状态分组、问题种子并限制最多 50 条', () => {
    expect(
      extractTrackerDomain('https://tracker.alpha.example.com/announce?passkey=fake-key'),
    ).toBe('alpha.example.com');
    expect(extractTrackerDomain('http://t.beta.example.com:8080/announce')).toBe(
      'beta.example.com',
    );
    expect(extractTrackerDomain('')).toBe('无 Tracker');

    const torrents: Array<Record<string, unknown>> = [
      {
        hash: 'h1',
        name: 'Seeding OK',
        state: 'uploading',
        size: 1000,
        tracker: 'https://tracker.alpha.example.com/announce',
        category: 'movies',
        progress: 1,
        num_complete: 10,
        num_incomplete: 2,
      },
      {
        hash: 'h2',
        name: 'Seeding Zero Peers',
        state: 'stalledUP',
        size: 2000,
        tracker: 'https://tracker.alpha.example.com/announce',
        category: 'movies',
        progress: 1,
        num_complete: 0,
        num_incomplete: 0,
      },
      {
        hash: 'h3',
        name: 'Downloading',
        state: 'downloading',
        size: 3000,
        tracker: 'https://announce.beta.example.com/announce',
        category: 'tv',
        progress: 0.5,
        num_seeds: 3,
        dlspeed: 1024,
      },
      {
        hash: 'h4',
        name: 'Paused',
        state: 'pausedUP',
        size: 4000,
        tracker: '',
        category: '',
        progress: 1,
      },
      {
        hash: 'h5',
        name: 'Errored',
        state: 'error',
        size: 5000,
        tracker: 'https://tracker.beta.example.com/announce',
        category: 'tv',
        progress: 0.2,
      },
    ];

    // 额外构造 55 个 stalledDL 种子测试 50 条上限
    for (let i = 0; i < 55; i += 1) {
      torrents.push({
        hash: `stalled-${i}`,
        name: `Stalled-${i}`,
        state: 'stalledDL',
        size: 500,
        tracker: 'https://tracker.beta.example.com/announce',
        category: 'tv',
        progress: 0.1,
      });
    }

    const summary = buildQbitSummaryData({
      version: 'v5.0.0',
      transferInfo: { up_info_speed: 2048, dl_info_speed: 1024 },
      maindata: null, // 测试降级近似汇总
      torrents: torrents.map((t) => ({ uploaded: 100, downloaded: 50, ...t })),
      categories: { movies: {}, tv: {} },
    });

    expect(summary.transfer.totalsApproximate).toBe(true);
    expect(summary.transfer.globalRatio).toBe(2);
    expect(summary.counts).toEqual({
      seeding: 2,
      downloading: 1,
      paused: 1,
      error: 1,
      stalled: 55,
      other: 0,
      total: 60,
    });
    expect(summary.byTracker[0]).toMatchObject({
      name: 'alpha.example.com',
      seedingCount: 2,
      totalCount: 2,
      totalSizeBytes: 3000,
    });
    expect(summary.problemTorrentsTotal).toBe(57); // h2 + h5 + 55 个 stalledDL
    expect(summary.problemTorrents).toHaveLength(50);
  });
});

describe('qBittorrent 登录、会话复用、403 重登与报错处理', () => {
  let database: DatabaseConnection;
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
  });

  async function loginAdmin(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    return extractCookiePair(res.headers.get('set-cookie'));
  }

  it('复用 SID cookie、遇 403 自动重登一次、且所有调用均命中只读白名单', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      QBIT_URL: 'http://192.0.2.10:8080',
      QBIT_USERNAME: 'demo',
      QBIT_PASSWORD: 'fake-qbit-password',
      QBIT_CACHE_SECONDS: '0',
    });

    const calledUrls: Array<{ method: string; path: string; cookie: string | null }> = [];
    let loginCount = 0;
    let triggerExpired403Once = false;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      calledUrls.push({ method, path: parsed.pathname, cookie: headers.get('Cookie') });

      if (parsed.pathname === '/api/v2/auth/login') {
        expect(headers.get('Referer')).toBe('http://192.0.2.10:8080');
        expect(headers.get('Origin')).toBe('http://192.0.2.10:8080');
        loginCount += 1;
        return new Response('Ok.', {
          status: 200,
          headers: { 'Set-Cookie': `SID=sid-${loginCount}; HttpOnly; path=/` },
        });
      }

      if (triggerExpired403Once && headers.get('Cookie') === 'SID=sid-1') {
        return new Response('Forbidden', { status: 403 });
      }

      if (parsed.pathname === '/api/v2/app/version') {
        return new Response('v5.0.2', { status: 200 });
      }
      if (parsed.pathname === '/api/v2/transfer/info') {
        return new Response(JSON.stringify({ up_info_speed: 5000, dl_info_speed: 1000 }), {
          status: 200,
        });
      }
      if (parsed.pathname === '/api/v2/sync/maindata') {
        return new Response(
          JSON.stringify({
            server_state: { alltime_ul: 10000, alltime_dl: 2000, global_ratio: '5.0' },
          }),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v2/torrents/info') {
        return new Response(
          JSON.stringify([
            {
              hash: 'demo-1',
              name: 'Demo.Torrent',
              state: 'uploading',
              size: 1024,
              tracker: 'https://tracker.demo.example.com/announce',
              category: 'movies',
              progress: 1,
              num_complete: 5,
              num_incomplete: 1,
            },
          ]),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v2/torrents/categories') {
        return new Response(JSON.stringify({ movies: { name: 'movies' } }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, { fetchFn: fetchMock });
    const cookie = await loginAdmin(app);

    // 首次请求：登录 1 次，复用 sid-1 完成全部 5 个 GET 请求
    const res1 = await app.request('/api/qbittorrent/summary', { headers: { Cookie: cookie } });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as QbitSummaryResponse;
    expect(body1.online).toBe(true);
    expect(body1.data?.version).toBe('v5.0.2');
    expect(loginCount).toBe(1);

    // 第二次请求：复用 sid-1（不重复登录）
    const res2 = await app.request('/api/qbittorrent/summary', { headers: { Cookie: cookie } });
    expect(res2.status).toBe(200);
    expect(loginCount).toBe(1);

    // 模拟 sid-1 过期触发 403，自动重登获取 sid-2 并成功返回
    triggerExpired403Once = true;
    const res3 = await app.request('/api/qbittorrent/summary', { headers: { Cookie: cookie } });
    expect(res3.status).toBe(200);
    expect(loginCount).toBe(2);

    // 断言从未调用过 trackers 单查询或写接口
    for (const call of calledUrls) {
      if (call.method === 'POST') {
        expect(call.path).toBe('/api/v2/auth/login');
      } else {
        expect(call.method).toBe('GET');
        expect(QBIT_ALLOWED_GET_PATHS).toContain(call.path);
      }
    }
  });

  it('登录返回 Fails. 或 403 banned 时返回明确中文错误提示', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      QBIT_URL: 'http://192.0.2.10:8080',
      QBIT_USERNAME: 'demo',
      QBIT_PASSWORD: 'fake-qbit-password',
      QBIT_CACHE_SECONDS: '0',
    });

    const failsFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Fails.', { status: 200 }));
    const appFails = createApp(config, database.db, { fetchFn: failsFetch });
    const cookie1 = await loginAdmin(appFails);
    const resFails = await appFails.request('/api/qbittorrent/summary', {
      headers: { Cookie: cookie1 },
    });
    const bodyFails = (await resFails.json()) as QbitSummaryResponse;
    expect(bodyFails.online).toBe(false);
    expect(bodyFails.errorCode).toBe('AUTH_FAILED');
    expect(bodyFails.error).toContain('认证失败');

    const bannedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('User IP is banned for too many failed login attempts', { status: 403 }),
      );
    const appBanned = createApp(config, database.db, { fetchFn: bannedFetch });
    const cookie2 = await loginAdmin(appBanned);
    const resBanned = await appBanned.request('/api/qbittorrent/summary', {
      headers: { Cookie: cookie2 },
    });
    const bodyBanned = (await resBanned.json()) as QbitSummaryResponse;
    expect(bodyBanned.online).toBe(false);
    expect(bodyBanned.errorCode).toBe('IP_BANNED');
    expect(bodyBanned.error).toContain('封禁');
  });

  it('支持 qBittorrent 5.x QBT_SID_8085 cookie 登录、复用与 403 自动重登，并携带同名 cookie', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      QBIT_URL: 'http://192.0.2.10:8085',
      QBIT_USERNAME: 'demo',
      QBIT_PASSWORD: 'fake-qbit-password',
      QBIT_CACHE_SECONDS: '0',
    });

    const calledUrls: Array<{ method: string; path: string; cookie: string | null }> = [];
    let loginCount = 0;
    let triggerExpired403Once = false;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      calledUrls.push({ method, path: parsed.pathname, cookie: headers.get('Cookie') });

      if (parsed.pathname === '/api/v2/auth/login') {
        loginCount += 1;
        return new Response('Ok.', {
          status: 200,
          headers: {
            'Set-Cookie': `QBT_SID_8085=qbt5-sid-${loginCount}; HttpOnly; path=/; SameSite=Strict`,
          },
        });
      }

      if (triggerExpired403Once && headers.get('Cookie') === 'QBT_SID_8085=qbt5-sid-1') {
        return new Response('Forbidden', { status: 403 });
      }

      if (parsed.pathname === '/api/v2/app/version') {
        return new Response('v5.1.0', { status: 200 });
      }
      if (parsed.pathname === '/api/v2/transfer/info') {
        return new Response(JSON.stringify({ up_info_speed: 3000, dl_info_speed: 500 }), {
          status: 200,
        });
      }
      if (parsed.pathname === '/api/v2/sync/maindata') {
        return new Response(
          JSON.stringify({
            server_state: { alltime_ul: 8000, alltime_dl: 2000, global_ratio: '4.0' },
          }),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v2/torrents/info') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (parsed.pathname === '/api/v2/torrents/categories') {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, { fetchFn: fetchMock });
    const cookie = await loginAdmin(app);

    const res1 = await app.request('/api/qbittorrent/summary', { headers: { Cookie: cookie } });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as QbitSummaryResponse;
    expect(body1.online).toBe(true);
    expect(body1.data?.version).toBe('v5.1.0');
    expect(loginCount).toBe(1);

    const res2 = await app.request('/api/qbittorrent/summary', { headers: { Cookie: cookie } });
    expect(res2.status).toBe(200);
    expect(loginCount).toBe(1);

    // 模拟 qB 5.x 会话过期返回 403，自动重登一次并携带新值
    triggerExpired403Once = true;
    const res3 = await app.request('/api/qbittorrent/summary', { headers: { Cookie: cookie } });
    expect(res3.status).toBe(200);
    expect(loginCount).toBe(2);

    const getCalls = calledUrls.filter((c) => c.method === 'GET');
    expect(getCalls.slice(0, 10).every((c) => c.cookie === 'QBT_SID_8085=qbt5-sid-1')).toBe(true);
    expect(getCalls.some((c) => c.cookie === 'QBT_SID_8085=qbt5-sid-2')).toBe(true);
  });

  it('正确解析多 Set-Cookie 头与逗号合并头，并在 cookie 名称不匹配时报错', async () => {
    // 1. getSetCookie 返回多个 Set-Cookie 头
    const multiHeaders = new Headers();
    multiHeaders.append('Set-Cookie', 'theme=dark; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/');
    multiHeaders.append('Set-Cookie', 'QBT_SID_8085=multi-token-1; HttpOnly; Path=/');
    expect(extractSessionCookieFromHeaders(multiHeaders)).toEqual({
      name: 'QBT_SID_8085',
      value: 'multi-token-1',
    });

    // 2. 仅 headers.get('set-cookie')（无 getSetCookie）时的逗号合并头，含 Expires 逗号、空 SID 与多 cookie
    const legacyFallbackHeaders = {
      get: (name: string) =>
        name.toLowerCase() === 'set-cookie'
          ? 'theme=dark; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/, SID=; Expires=Thu, 01 Jan 1970 00:00:00 GMT, XSID=ignored; Path=/, QBT_SID_8085=merged-token==; HttpOnly; Path=/'
          : null,
    } as unknown as Headers;

    const mergedQbitFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v2/auth/login') {
        return {
          ok: true,
          status: 200,
          headers: legacyFallbackHeaders,
          text: async () => 'Ok.',
        } as unknown as Response;
      }
      const reqHeaders = new Headers(init?.headers);
      expect(reqHeaders.get('Cookie')).toBe('QBT_SID_8085=merged-token==');
      return new Response('v5.0.4', { status: 200 });
    });

    const mergedClient = createQbitClient(mergedQbitFetch);
    const version5 = await mergedClient.getVersion({
      url: 'http://192.0.2.10:8085',
      username: 'demo',
      password: 'fake-qbit-password',
      timeoutMs: 3000,
    });
    expect(version5).toBe('v5.0.4');

    // 3. 合并头中包含旧版 SID 时同样工作
    const mergedLegacyHeaders = new Headers({
      'Set-Cookie': 'other=1; Path=/, SID=legacy-merged-1; HttpOnly; Path=/',
    });
    const legacyMergedFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v2/auth/login') {
        return new Response('Ok.', { status: 200, headers: mergedLegacyHeaders });
      }
      const reqHeaders = new Headers(init?.headers);
      expect(reqHeaders.get('Cookie')).toBe('SID=legacy-merged-1');
      return new Response('v4.6.7', { status: 200 });
    });

    const legacyClient = createQbitClient(legacyMergedFetch);
    const version4 = await legacyClient.getVersion({
      url: 'http://192.0.2.10:8080',
      username: 'demo',
      password: 'fake-qbit-password',
      timeoutMs: 3000,
    });
    expect(version4).toBe('v4.6.7');

    // 4. 不匹配名称（如 XSID、QBT_SID_abc 等）返回 null 并触发 AUTH_FAILED 报错
    const invalidCookieHeaders = [
      'XSID=invalid-1; HttpOnly; Path=/',
      'QBT_SID_abc=invalid-2; HttpOnly; Path=/',
      'QBT_SID_=invalid-3; Path=/',
      'MY_SID=invalid-4; Path=/',
      'sid=lowercase-invalid; Path=/',
      'SID=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
      'other=1; Path=/; QBT_SID_8085=in-attr',
    ];

    for (const rawSetCookie of invalidCookieHeaders) {
      expect(
        extractSessionCookieFromHeaders(new Headers({ 'Set-Cookie': rawSetCookie })),
      ).toBeNull();

      const invalidFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('Ok.', { status: 200, headers: { 'Set-Cookie': rawSetCookie } }),
        );
      const invalidClient = createQbitClient(invalidFetch);
      await expect(
        invalidClient.getVersion({
          url: 'http://192.0.2.10:8085',
          username: 'demo',
          password: 'fake-qbit-password',
          timeoutMs: 3000,
        }),
      ).rejects.toMatchObject({
        name: 'QbitClientError',
        code: 'AUTH_FAILED',
        message: 'qBittorrent 登录未返回有效会话 Cookie',
      });
    }
  });

  it('QBIT_MOCK=true 返回模拟数据', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      QBIT_MOCK: 'true',
    });
    const app = createApp(config, database.db);
    const cookie = await loginAdmin(app);
    const res = await app.request('/api/qbittorrent/summary', { headers: { Cookie: cookie } });
    const body = (await res.json()) as QbitSummaryResponse;
    expect(body.configured).toBe(true);
    expect(body.mock).toBe(true);
    expect(body.online).toBe(true);
    expect(body.data?.byTracker.length).toBeGreaterThan(0);
  });
});
