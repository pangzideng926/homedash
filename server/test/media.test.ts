import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig, SERVER_ROOT } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import type {
  MediaDownloadsResponse,
  MediaOverviewResponse,
  MediaSubscriptionsResponse,
} from '../src/media/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  return setCookieHeader?.split(';')[0] ?? '';
}

describe('影视模块 V1 后端聚合接口与业务逻辑', () => {
  let database: DatabaseConnection;
  let passwordHash: string;
  const tempFiles: string[] = [];

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
    for (const filePath of tempFiles) {
      fs.rmSync(filePath, { recursive: true, force: true });
    }
    tempFiles.length = 0;
  });

  function writeIntegrationsFixture(downloaders: unknown[]): string {
    const dir = path.join(
      SERVER_ROOT,
      'data',
      `.tmp-media-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    tempFiles.push(dir);
    const filePath = path.join(dir, 'integrations.json');
    fs.writeFileSync(filePath, JSON.stringify({ downloaders }, null, 2), 'utf-8');
    return filePath;
  }

  async function loginAdmin(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    return extractCookiePair(res.headers.get('set-cookie'));
  }

  function createDownloadersFixture() {
    return [
      {
        id: 'qb-dl',
        name: 'qB 下载',
        type: 'qbittorrent',
        url: 'http://192.0.2.10:8080',
        username: 'demo',
        tags: ['download'],
        enabled: true,
      },
      {
        id: 'qb-brush',
        name: 'qB 刷流',
        type: 'qbittorrent',
        url: 'http://192.0.2.11:8080',
        username: 'demo',
        tags: ['brush'],
        enabled: true,
      },
      {
        id: 'tr-seed',
        name: 'TR 保种',
        type: 'transmission',
        url: 'http://192.0.2.12:9091',
        username: 'demo',
        tags: ['seed'],
        enabled: true,
      },
    ];
  }

  it('按 tag 归属隔离 brush 实例，overview 统计去重、按 TZ_DISPLAY 计算今日入库并合并同剧多集', async () => {
    const integrationsFile = writeIntegrationsFixture([
      {
        id: 'qb-dl',
        name: 'qB 下载',
        type: 'qbittorrent',
        url: 'http://192.0.2.10:8080',
        username: 'demo',
        tags: ['download'],
        enabled: true,
      },
      {
        id: 'qb-brush',
        name: 'qB 刷流',
        type: 'qbittorrent',
        url: 'http://192.0.2.11:8080',
        username: 'demo',
        tags: ['brush'],
        enabled: true,
      },
      {
        id: 'tr-seed',
        name: 'TR 保种',
        type: 'transmission',
        url: 'http://192.0.2.12:9091',
        username: 'demo',
        tags: ['seed'],
        enabled: true,
      },
    ]);

    // 先通过接口写入带密码的 downloaders 配置（避免自己手拼加密字段）
    const baseConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
      TZ_DISPLAY: 'Asia/Shanghai',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token',
      MEDIA_CACHE_SECONDS: '30',
    });

    // 固定时间为 UTC 2026-11-26T20:00:00Z -> Asia/Shanghai 2026-11-27 04:00:00
    const fixedNow = Date.parse('2026-11-26T20:00:00.000Z');
    const brushUrlsHit: string[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith('http://192.0.2.11:8080')) {
        brushUrlsHit.push(url);
        return new Response('should not call brush', { status: 500 });
      }
      if (url === 'http://192.0.2.10:8080/api/v2/auth/login') {
        return new Response('Ok.', {
          status: 200,
          headers: { 'Set-Cookie': 'SID=qb-dl-sid; path=/' },
        });
      }
      if (url === 'http://192.0.2.10:8080/api/v2/torrents/info') {
        return new Response(
          JSON.stringify([
            {
              hash: 'ABC123',
              name: 'Demo.Show.S01E01.mkv',
              state: 'downloading',
              progress: 0.5,
              dlspeed: 5_000_000,
              upspeed: 100_000,
              eta: 120,
              size: 2_000_000_000,
            },
            {
              hash: 'ONLY_QB_1',
              name: '[DemoSite].Unmatched.Film.2025.1080p',
              state: 'downloading',
              progress: 0.2,
              dlspeed: 1_000_000,
              upspeed: 0,
              eta: 600,
              size: 4_000_000_000,
            },
            {
              hash: 'SEEDING_DONE',
              name: 'Finished.Torrent',
              state: 'uploading',
              progress: 1,
              dlspeed: 0,
              upspeed: 500,
            },
          ]),
          { status: 200 },
        );
      }
      if (url === 'http://192.0.2.12:9091/transmission/rpc') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { method: string };
        if (body.method === 'session-get') {
          return new Response(
            JSON.stringify({ result: 'success', arguments: { version: '4.0.6' } }),
            {
              status: 200,
            },
          );
        }
        if (body.method === 'session-stats') {
          return new Response(
            JSON.stringify({
              result: 'success',
              arguments: {
                uploadSpeed: 8_000_000,
                downloadSpeed: 0,
                'cumulative-stats': {
                  uploadedBytes: 500_000_000_000,
                  downloadedBytes: 100_000_000_000,
                },
              },
            }),
            { status: 200 },
          );
        }
        if (body.method === 'torrent-get') {
          return new Response(
            JSON.stringify({
              result: 'success',
              arguments: {
                torrents: [
                  {
                    id: 1,
                    name: 'Seed.1',
                    status: 6,
                    totalSize: 1000,
                    percentDone: 1,
                    rateUpload: 8_000_000,
                    rateDownload: 0,
                  },
                  {
                    id: 2,
                    name: 'Seed.2',
                    status: 6,
                    totalSize: 1000,
                    percentDone: 1,
                    rateUpload: 0,
                    rateDownload: 0,
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
      }

      if (url.startsWith('https://mp.example.com/api/v1/download/')) {
        return new Response(
          JSON.stringify([
            // 与 qB hash 'ABC123' 大小写不同，应去重
            { hash: 'abc123', title: '示例剧集', state: 'downloading', downloader: 'qB 下载' },
            // 属于 brush 实例的任务应排除
            { hash: 'brush-hash', title: '刷流种子', state: 'downloading', downloader: 'qB 刷流' },
            // 另一条 MP 下载任务
            {
              hash: 'mp-only-hash',
              title: '另一部剧',
              state: 'downloading',
              downloader: 'qB 下载',
            },
          ]),
          { status: 200 },
        );
      }

      if (url.startsWith('https://mp.example.com/api/v1/transfer/queue/page')) {
        return new Response(JSON.stringify({ items: [], total: 4 }), { status: 200 });
      }

      if (url.startsWith('https://mp.example.com/api/v1/dashboard/statistic')) {
        return new Response(
          JSON.stringify({ movie_count: 120, tv_count: 35, episode_count: 980 }),
          { status: 200 },
        );
      }

      if (url.startsWith('https://mp.example.com/api/v1/history/transfer')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              total: 4,
              list: [
                {
                  id: 1,
                  title: '合并剧集',
                  year: '2026',
                  type: '电视剧',
                  seasons: 'S01',
                  episodes: 'E03',
                  image: 'https://image.tmdb.org/t/p/original/show.jpg',
                  status: true,
                  date: '2026-11-27 01:15:00',
                  dest: '/secret/nas/media/show-e03.mkv',
                },
                {
                  id: 2,
                  title: '合并剧集',
                  year: '2026',
                  type: '电视剧',
                  seasons: 'S01',
                  episodes: 'E04-E05',
                  image: '/api/v1/system/img?path=bad',
                  status: true,
                  date: '2026-11-27 02:30:00',
                  dest: '/secret/nas/media/show-e04.mkv',
                },
                {
                  id: 3,
                  title: '失败记录',
                  year: '2026',
                  type: '电影',
                  seasons: '',
                  episodes: '',
                  status: false,
                  date: '2026-11-27 03:00:00',
                },
                {
                  id: 4,
                  title: '昨日电影',
                  year: '2025',
                  type: '电影',
                  seasons: '',
                  episodes: '',
                  image: 'https://img1.doubanio.com/poster.jpg',
                  status: true,
                  date: '2026-11-26 22:00:00',
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(baseConfig, database.db, {
      fetchFn: fetchMock,
      now: () => fixedNow,
      mediaImageCacheDir: null,
    });
    const cookie = await loginAdmin(app);

    // 写入带密码的 downloaders 配置
    const putRes = await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        downloaders: createDownloadersFixture().map((d) => ({ ...d, password: 'fake-dl-pass' })),
      }),
    });
    expect(putRes.status).toBe(200);

    const res = await app.request('/api/media/overview', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('/secret/nas/media');
    expect(text).not.toContain('fake-dl-pass');
    expect(text).not.toContain('fake-mp-token');
    expect(brushUrlsHit).toHaveLength(0);

    const body = JSON.parse(text) as MediaOverviewResponse;
    expect(body.configured).toBe(true);
    expect(body.cached).toBe(false);
    expect(body.warnings).toEqual([]);
    // qB-download 中 2 个下载中（ABC123, ONLY_QB_1）+ MP 1 个新 hash（mp-only-hash）= 3
    expect(body.stats.downloading).toBe(3);
    expect(body.stats.pendingTransfer).toBe(4);
    expect(body.stats.todayImported).toBe(2);
    expect(body.stats.todayImportedApproximate).toBe(false);
    expect(body.stats.seeding).toBe(2);
    expect(body.stats.seedUploadSpeed).toBe(8_000_000);
    expect(body.stats.seedTotalUploaded).toBe(500_000_000_000);
    expect(body.stats.library).toEqual({ movieCount: 120, tvCount: 35, episodeCount: 980 });

    // 合并同剧多集为 1 张卡 + 昨日电影 = 2 张卡
    expect(body.recent).toHaveLength(2);
    expect(body.recent[0]).toMatchObject({
      title: '合并剧集',
      season: 'S01',
      episodes: 'E03-E05',
      episodeCount: 3,
      date: '2026-11-27 02:30:00',
    });
    expect(body.recent[0]?.posterUrl).toMatch(/^\/api\/media\/image\//);
    expect(body.recent[1]).toMatchObject({ title: '昨日电影' });

    // 第二次请求命中缓存
    const cachedRes = await app.request('/api/media/overview', { headers: { Cookie: cookie } });
    const cachedBody = (await cachedRes.json()) as MediaOverviewResponse;
    expect(cachedBody.cached).toBe(true);

    // ?refresh=1 强刷
    const refreshRes = await app.request('/api/media/overview?refresh=1', {
      headers: { Cookie: cookie },
    });
    const refreshBody = (await refreshRes.json()) as MediaOverviewResponse;
    expect(refreshBody.cached).toBe(false);
  });

  it('todayImported 在最近 100 条全部为今日时标注 approximate=true', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      TZ_DISPLAY: 'Asia/Shanghai',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token',
    });
    const fixedNow = Date.parse('2026-11-27T10:00:00+08:00');
    const hundredToday = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      title: `剧集 ${i + 1}`,
      status: true,
      date: '2026-11-27 08:00:00',
    }));

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://mp.example.com/api/v1/history/transfer')) {
        return new Response(JSON.stringify({ data: { list: hundredToday, total: 150 } }), {
          status: 200,
        });
      }
      if (url.startsWith('https://mp.example.com/api/v1/download/')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.startsWith('https://mp.example.com/api/v1/transfer/queue/page')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      }
      if (url.startsWith('https://mp.example.com/api/v1/dashboard/statistic')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, {
      fetchFn: fetchMock,
      now: () => fixedNow,
      mediaImageCacheDir: null,
    });
    const cookie = await loginAdmin(app);
    const res = await app.request('/api/media/overview', { headers: { Cookie: cookie } });
    const body = (await res.json()) as MediaOverviewResponse;
    expect(body.stats.todayImported).toBe(100);
    expect(body.stats.todayImportedApproximate).toBe(true);
    expect(body.recent.length).toBeLessThanOrEqual(24);
  });

  it('downloads 接口实现 hash 不区分大小写合并、海报回退、未匹配种子名清洗与速度/进度排序', async () => {
    const integrationsFile = writeIntegrationsFixture([]);
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token',
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === 'http://192.0.2.10:8080/api/v2/auth/login') {
        return new Response('Ok.', {
          status: 200,
          headers: { 'Set-Cookie': 'SID=qb-sid; path=/' },
        });
      }
      if (url === 'http://192.0.2.10:8080/api/v2/torrents/info') {
        return new Response(
          JSON.stringify([
            {
              hash: 'HASH_MATCH_1',
              name: 'Show.Name.S01E02.1080p',
              state: 'downloading',
              progress: 0.35,
              dlspeed: 2_000_000,
              upspeed: 500_000,
              eta: 300,
              size: 3_000_000_000,
            },
            {
              hash: 'HASH_UNMATCH_FAST',
              name: '[ExampleSite][1080p].Raw.Movie.2026.WEB-DL',
              state: 'downloading',
              progress: 0.15,
              dlspeed: 8_000_000,
              upspeed: 100_000,
              eta: 120,
              size: 5_000_000_000,
            },
            {
              hash: 'HASH_STALLED',
              name: 'Stalled.Show.S01E01',
              state: 'stalledDL',
              progress: 0.8,
              dlspeed: 0,
              upspeed: 0,
              eta: 8640000,
              size: 1_000_000_000,
            },
            {
              hash: 'HASH_DONE_SEEDING',
              name: 'Completed.Should.Filter',
              state: 'uploading',
              progress: 1,
              dlspeed: 0,
              upspeed: 1000,
              size: 1_000_000_000,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.startsWith('https://mp.example.com/api/v1/download/')) {
        return new Response(
          JSON.stringify([
            {
              hash: 'hash_match_1',
              title: '中文片名 Alpha',
              name: 'Show.Name.S01E02.1080p',
              year: '2026',
              season_episode: 'S01E02',
              media_id: 'tmdb:999',
              size: 3_000_000_000,
              progress: 35,
              state: 'downloading',
              dlspeed: '1.0 MB/s',
              upspeed: '0.1 MB/s',
              downloader: 'qB 下载',
              site_name: '站点甲',
            },
          ]),
          { status: 200 },
        );
      }
      if (url.startsWith('https://mp.example.com/api/v1/subscribe/list')) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              name: '中文片名 Alpha',
              media_id: 'tmdb:999',
              poster: 'https://image.tmdb.org/t/p/original/alpha.jpg',
            },
          ]),
          { status: 200 },
        );
      }
      if (url.startsWith('https://mp.example.com/api/v1/history/transfer')) {
        return new Response(JSON.stringify({ data: { list: [], total: 0 } }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, {
      fetchFn: fetchMock,
      mediaImageCacheDir: null,
    });
    const cookie = await loginAdmin(app);
    await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qb-dl',
            name: 'qB 下载',
            type: 'qbittorrent',
            url: 'http://192.0.2.10:8080',
            username: 'demo',
            password: 'fake-password',
            tags: ['download'],
            enabled: true,
          },
        ],
      }),
    });

    const res = await app.request('/api/media/downloads', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MediaDownloadsResponse;

    expect(body.items).toHaveLength(3);
    // 排序：下载中按 dlSpeed 降序（8MB/s > 2MB/s），其余按进度（0.8）
    expect(body.items[0]).toMatchObject({
      hash: 'HASH_UNMATCH_FAST',
      displayName: 'Raw Movie 2026 WEB-DL',
      matched: false,
      posterUrl: null,
      dlSpeed: 8_000_000,
    });
    expect(body.items[1]).toMatchObject({
      hash: 'HASH_MATCH_1',
      displayName: '中文片名 Alpha',
      seasonEpisode: 'S01E02',
      matched: true,
      dlSpeed: 2_000_000,
      site: '站点甲',
    });
    expect(body.items[1]?.posterUrl).toMatch(/^\/api\/media\/image\//);
    expect(body.items[2]).toMatchObject({
      hash: 'HASH_STALLED',
      state: '等待连接',
      eta: null,
      matched: false,
    });
  });

  it('subscriptions 计算缺集（日历精确模式）、nextAir、排序及日历失败时推断降级', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      TZ_DISPLAY: 'Asia/Shanghai',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token',
    });
    const fixedNow = Date.parse('2026-11-27T12:00:00+08:00');
    let calendarShouldFail = false;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://mp.example.com/api/v1/subscribe/list')) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              name: '无缺集剧',
              year: '2026',
              type: '电视剧',
              season: 1,
              state: 'R',
              start_episode: 1,
              total_episode: 10,
              lack_episode: 0,
              note: [1, 2],
              last_update: '2026-11-26 10:00:00',
            },
            {
              id: 2,
              name: '近七天新集剧',
              year: '2026',
              type: '电视剧',
              season: 1,
              state: 'R',
              start_episode: 1,
              total_episode: 12,
              lack_episode: 0,
              note: [1, 2],
              last_update: '2026-11-25 10:00:00',
            },
            {
              id: 3,
              name: '有缺集剧',
              year: '2026',
              type: '电视剧',
              season: 2,
              state: 'R',
              start_episode: 1,
              total_episode: 10,
              lack_episode: 2,
              note: [1, 3],
              poster: 'https://image.tmdb.org/t/p/original/missing.jpg',
              last_update: '2026-11-24 10:00:00',
            },
          ]),
          { status: 200 },
        );
      }

      if (url.startsWith('https://mp.example.com/api/v1/subscribe/calendar')) {
        if (calendarShouldFail) {
          return new Response('Forbidden', { status: 403 });
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                date: '2026-11-20',
                episodes: [{ episode_number: 2, name: '第二集' }],
                subscribe: { id: 3, name: '有缺集剧', season: 2 },
              },
              {
                date: '2026-11-25',
                episodes: [{ episode_number: 4, name: '第四集' }],
                subscribe: { id: 3, name: '有缺集剧', season: 2 },
              },
              {
                date: '2026-11-30',
                episodes: [{ episode_number: 3, name: '第三集' }],
                subscribe: { id: 2, name: '近七天新集剧', season: 1 },
              },
              {
                date: '2026-12-20',
                episodes: [{ episode_number: 3, name: '第三集' }],
                subscribe: { id: 1, name: '无缺集剧', season: 1 },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, {
      fetchFn: fetchMock,
      now: () => fixedNow,
      mediaImageCacheDir: null,
    });
    const cookie = await loginAdmin(app);

    // 1. 日历可用模式
    const res1 = await app.request('/api/media/subscriptions', { headers: { Cookie: cookie } });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as MediaSubscriptionsResponse;
    expect(body1.calendarAvailable).toBe(true);
    expect(body1.warnings).toEqual([]);
    // 排序：有缺集(3) > 近7天有新集(2) > 其它(1)
    expect(body1.items.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(body1.items[0]?.missingEpisodes).toEqual([2, 4]);
    expect(body1.items[0]?.missingInferred).toBe(false);
    expect(body1.items[1]?.nextAir).toEqual({
      date: '2026-11-30',
      episodeNumber: 3,
      name: '第三集',
    });

    // 2. 日历接口失败降级 + 推断缺集
    calendarShouldFail = true;
    const res2 = await app.request('/api/media/subscriptions?refresh=1', {
      headers: { Cookie: cookie },
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as MediaSubscriptionsResponse;
    expect(body2.calendarAvailable).toBe(false);
    expect(body2.warnings).toContain('无法获取播出日历');
    expect(body2.items[0]).toMatchObject({
      id: 3,
      missingInferred: true,
      missingEpisodes: [2, 4],
      nextAir: null,
    });
  });
});
