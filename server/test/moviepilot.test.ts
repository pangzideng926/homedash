import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  assertMoviepilotRequestAllowed,
  buildMoviepilotSummaryData,
  MOVIEPILOT_ALLOWED_GET_PATHS,
  MoviepilotClientError,
  type MoviepilotSummaryResponse,
} from '../src/moviepilot/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  return setCookieHeader?.split(';')[0] ?? '';
}

describe('MoviePilot v3 白名单与字段容错/敏感字段剥离', () => {
  it('强制白名单仅放行 7 个只读 GET 接口，拦截任何写接口或站点测试接口', () => {
    expect(MOVIEPILOT_ALLOWED_GET_PATHS).toContain('/api/v1/transfer/queue/page');
    expect(MOVIEPILOT_ALLOWED_GET_PATHS).toHaveLength(7);

    for (const allowed of MOVIEPILOT_ALLOWED_GET_PATHS) {
      expect(() => assertMoviepilotRequestAllowed('GET', allowed)).not.toThrow();
    }

    const forbidden: Array<[string, string]> = [
      ['GET', '/api/v1/site/test/1'],
      ['GET', '/api/v1/transfer/now'],
      ['POST', '/api/v1/transfer/now'],
      ['GET', '/api/v1/download/start'],
      ['POST', '/api/v1/download/start'],
      ['GET', '/api/v1/download/stop'],
      ['POST', '/api/v1/download/stop'],
      ['POST', '/api/v1/transfer/queue/page'],
      ['POST', '/api/v1/system/runscheduler'],
      ['DELETE', '/api/v1/subscribe/1'],
      ['DELETE', '/api/v1/transfer/queue'],
      ['DELETE', '/api/v1/download/1'],
    ];
    for (const [method, apiPath] of forbidden) {
      expect(() => assertMoviepilotRequestAllowed(method, apiPath)).toThrow(MoviepilotClientError);
    }
  });

  it('严格剥离站点 cookie/ua/apikey/token/url 等敏感字段，且容忍字段缺失', () => {
    const secretCookie = 'fake_secret_cookie_xyz';
    const secretUa = 'FakeCustomUA/1.0';
    const secretApiKey = 'fake_site_apikey_999';
    const secretToken = 'fake_site_token_888';

    const data = buildMoviepilotSummaryData({
      subscribes: [{ id: 1, name: '示例剧集' }], // 故意缺失 year/season/lack_episode 等
      transfers: { success: true, data: { list: [{ title: '示例电影', status: true }], total: 1 } },
      downloads: [{ title: '下载任务', progress: 0.45 }],
      sites: [
        {
          id: 10,
          name: '示例站点',
          domain: 'pt.example.com',
          url: 'https://pt.example.com/secret-rss',
          is_active: true,
          pri: 2,
          cookie: secretCookie,
          ua: secretUa,
          apikey: secretApiKey,
          token: secretToken,
        },
      ],
      siteStatistics: [
        {
          domain: 'pt.example.com',
          success: 20,
          fail: 1,
          seconds: 0.567,
          lst_state: 0,
          lst_mod_date: '2026-11-27 10:00:00',
        },
      ],
      downloader2: null,
    });

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(secretCookie);
    expect(serialized).not.toContain(secretUa);
    expect(serialized).not.toContain(secretApiKey);
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain('secret-rss');

    expect(data.sites[0]).toEqual({
      id: 10,
      name: '示例站点',
      domain: 'pt.example.com',
      isActive: true,
      priority: 2,
      successCount: 20,
      failCount: 1,
      avgSeconds: 0.57,
      lastState: 'success',
      lastModDate: '2026-11-27 10:00:00',
    });
    expect(data.downloads[0]?.progress).toBe(45);
    expect(data.subscribes[0]?.lackEpisode).toBeNull();
  });

  it('解析 activeDownloads 与 transferQueue（仅返回文件 basename、统计状态计数、支持 limit 截断）', () => {
    const data = buildMoviepilotSummaryData({
      subscribes: [],
      transfers: [],
      downloads: [
        {
          hash: 'h1',
          title: '剧集 A',
          name: 'Show.A.S01E01.1080p',
          year: '2025',
          season_episode: 'S01E01',
          downloader: 'qB 下载',
          size: 4096,
          progress: 62.5,
          state: 'downloading',
          dlspeed: '15.2 MB/s',
          upspeed: '1.1 MB/s',
          category: '欧美剧',
          site_name: '站点甲',
        },
        {
          hash: 'h2',
          title: '电影 B',
          name: 'Movie.B.2025',
          progress: 20,
          dlspeed: '3.0 MB/s',
          upspeed: '0 B/s',
        },
      ],
      transferQueue: {
        items: [
          {
            media: {
              title: '示例剧集',
              title_year: '示例剧集 (2025)',
              year: '2025',
              poster_path: '/secret/poster.jpg',
            },
            season: 2,
            tasks: [
              {
                fileitem: {
                  name: '',
                  path: '/volume1/media/downloads/Show.S02E01.mkv',
                  size: 1000,
                },
                state: 'running',
              },
              {
                fileitem: {
                  name: 'Show.S02E02.mkv',
                  path: 'C:\\SecretDownloads\\Show.S02E02.mkv',
                  size: 1000,
                },
                state: 'waiting',
              },
              {
                fileitem: {
                  path: '/volume1/media/downloads/Show.S02E03.mkv',
                },
                state: 'waiting',
              },
              {
                fileitem: {
                  path: '/volume1/media/downloads/Show.S02E04.mkv',
                },
                state: 'completed',
              },
            ],
          },
          {
            media: { title: '第二项' },
            season: 1,
            tasks: [],
          },
        ],
        total: 5,
        page: 1,
        count: 20,
      },
      sites: [],
      siteStatistics: [],
      downloader2: null,
      activeLimit: 1,
    });

    expect(data.activeDownloadsTotal).toBe(2);
    expect(data.activeDownloads).toHaveLength(1);
    expect(data.activeDownloads[0]).toMatchObject({
      hash: 'h1',
      title: '剧集 A',
      seasonEpisode: 'S01E01',
      downloader: 'qB 下载',
      progress: 62.5,
      dlSpeedText: '15.2 MB/s',
      upSpeedText: '1.1 MB/s',
      siteName: '站点甲',
    });

    expect(data.transferQueue.available).toBe(true);
    expect(data.transferQueueTotal).toBe(5);
    expect(data.transferQueue.items).toHaveLength(1);
    expect(data.transferQueue.items[0]).toEqual({
      title: '示例剧集',
      year: '2025',
      season: 'S02',
      taskCount: 4,
      stateCounts: { running: 1, waiting: 2, completed: 1 },
      sampleFiles: ['Show.S02E01.mkv', 'Show.S02E02.mkv', 'Show.S02E03.mkv'],
    });
    const serialized = JSON.stringify(data.transferQueue);
    expect(serialized).not.toContain('/volume1/media/downloads');
    expect(serialized).not.toContain('SecretDownloads');
    expect(serialized).not.toContain('poster.jpg');
  });
});

describe('MoviePilot API 集成（X-API-KEY、401 中文错误与模拟模式）', () => {
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

  it('请求头携带 X-API-KEY，仅调用白名单接口并剥离敏感字段', async () => {
    const fakeToken = 'fake-mp-api-token-abc';
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: fakeToken,
      MOVIEPILOT_CACHE_SECONDS: '60',
    });

    const requestedPaths: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe('GET');
      expect(headers.get('X-API-KEY')).toBe(fakeToken);
      requestedPaths.push(parsed.pathname);

      if (parsed.pathname === '/api/v1/subscribe/list') {
        return new Response(JSON.stringify([{ id: 1, name: '剧集 A', state: 'R' }]), {
          status: 200,
        });
      }
      if (parsed.pathname === '/api/v1/history/transfer') {
        return new Response(
          JSON.stringify({
            success: true,
            data: { list: [{ title: '电影 B', status: true }], total: 1 },
          }),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v1/download/') {
        return new Response(
          JSON.stringify([
            {
              hash: 'dl-1',
              title: '示例下载',
              name: 'Demo.Movie.2025',
              season_episode: 'S01E01',
              downloader: 'qBittorrent',
              size: 1024,
              progress: 55,
              state: 'downloading',
              dlspeed: '10.0 MB/s',
              upspeed: '1.0 MB/s',
              category: '电影',
              site_name: '站点甲',
            },
          ]),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v1/transfer/queue/page') {
        expect(parsed.searchParams.get('page')).toBe('1');
        expect(parsed.searchParams.get('count')).toBe('20');
        return new Response(
          JSON.stringify({
            items: [
              {
                media: { title: '整理剧集', year: '2025' },
                season: 1,
                tasks: [
                  {
                    fileitem: { name: '', path: '/hidden/dir/Episode.01.mkv', size: 100 },
                    state: 'waiting',
                  },
                ],
              },
            ],
            total: 1,
            page: 1,
            count: 20,
          }),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v1/site/') {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              name: '站点甲',
              domain: 'alpha.example.com',
              is_active: true,
              pri: 1,
              cookie: 'fake-site-cookie-do-not-leak',
              apikey: 'fake-site-apikey-do-not-leak',
            },
          ]),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v1/site/statistic') {
        return new Response(
          JSON.stringify([
            { domain: 'alpha.example.com', success: 10, fail: 0, seconds: 0.3, lst_state: 0 },
          ]),
          { status: 200 },
        );
      }
      if (parsed.pathname === '/api/v1/dashboard/downloader2') {
        return new Response(JSON.stringify({ download_speed: 1024, upload_speed: 2048 }), {
          status: 200,
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, { fetchFn: fetchMock });
    const cookie = await loginAdmin(app);
    const res = await app.request('/api/moviepilot/summary', { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('fake-site-cookie-do-not-leak');
    expect(text).not.toContain('fake-site-apikey-do-not-leak');
    expect(text).not.toContain(fakeToken);

    const body = JSON.parse(text) as MoviepilotSummaryResponse;
    expect(body.online).toBe(true);
    expect(body.data?.sites[0]?.domain).toBe('alpha.example.com');
    expect(body.data?.activeDownloadsTotal).toBe(1);
    expect(body.data?.transferQueue.available).toBe(true);
    expect(body.data?.transferQueue.items[0]?.sampleFiles).toEqual(['Episode.01.mkv']);
    expect(text).not.toContain('/hidden/dir');
    for (const p of requestedPaths) {
      expect(MOVIEPILOT_ALLOWED_GET_PATHS).toContain(p);
    }
  });

  it('当 /api/v1/transfer/queue/page 返回 404 时降级标记 unavailable 且不影响其它数据', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token',
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v1/subscribe/list') {
        return new Response(JSON.stringify([{ id: 1, name: '剧集 A', state: 'R' }]), {
          status: 200,
        });
      }
      if (parsed.pathname === '/api/v1/history/transfer') {
        return new Response(JSON.stringify({ data: { list: [], total: 0 } }), { status: 200 });
      }
      if (parsed.pathname === '/api/v1/download/') {
        return new Response(JSON.stringify([{ title: '正在下载项', progress: 40 }]), {
          status: 200,
        });
      }
      if (parsed.pathname === '/api/v1/transfer/queue/page') {
        return new Response('Not Found', { status: 404 });
      }
      if (parsed.pathname === '/api/v1/site/' || parsed.pathname === '/api/v1/site/statistic') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (parsed.pathname === '/api/v1/dashboard/downloader2') {
        return new Response(JSON.stringify({ download_speed: 100, upload_speed: 200 }), {
          status: 200,
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, { fetchFn: fetchMock });
    const cookie = await loginAdmin(app);
    const res = await app.request('/api/moviepilot/summary', { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as MoviepilotSummaryResponse;
    expect(body.online).toBe(true);
    expect(body.data?.subscribes).toHaveLength(1);
    expect(body.data?.activeDownloadsTotal).toBe(1);
    expect(body.data?.transferQueue).toEqual({
      available: false,
      reason: '当前 MoviePilot 版本不支持整理队列',
      items: [],
      total: 0,
    });
    expect(body.data?.transferQueueTotal).toBe(0);
  });

  it('401 鉴权失败返回中文错误，MOVIEPILOT_MOCK=true 返回模拟数据', async () => {
    const config401 = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-invalid-token',
    });
    const fetch401 = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const app401 = createApp(config401, database.db, { fetchFn: fetch401 });
    const cookie = await loginAdmin(app401);

    const res401 = await app401.request('/api/moviepilot/summary', { headers: { Cookie: cookie } });
    const body401 = (await res401.json()) as MoviepilotSummaryResponse;
    expect(body401.online).toBe(false);
    expect(body401.errorCode).toBe('AUTH_FAILED');
    expect(body401.error).toContain('认证失败');

    const mockConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      MOVIEPILOT_MOCK: 'true',
    });
    const appMock = createApp(mockConfig, database.db);
    const resMock = await appMock.request('/api/moviepilot/summary', {
      headers: { Cookie: cookie },
    });
    const bodyMock = (await resMock.json()) as MoviepilotSummaryResponse;
    expect(bodyMock.mock).toBe(true);
    expect(bodyMock.online).toBe(true);
    expect(bodyMock.data?.subscribes.length).toBeGreaterThan(0);
  });
});
