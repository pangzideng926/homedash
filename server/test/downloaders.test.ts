import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  assertTransmissionRpcAllowed,
  buildQbitInstanceSummary,
  buildTransmissionInstanceSummary,
  normalizeTransmissionRpcUrl,
  TRANSMISSION_ALLOWED_METHODS,
  TRANSMISSION_TORRENT_FIELDS,
  TransmissionClientError,
  type DownloaderInstanceSummary,
  type DownloadersSummaryResponse,
  type DownloaderTestResponse,
} from '../src/downloaders/index.js';
import type { DownloadersListResponse } from '../src/integrations/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('缺少 Set-Cookie');
  return setCookieHeader.split(';')[0] ?? '';
}

describe('Transmission 只读白名单与状态映射', () => {
  it('严格校验只读方法与字段白名单，拒绝 torrent-start/stop/remove/set/add 等写操作', () => {
    expect(() => assertTransmissionRpcAllowed('session-get')).not.toThrow();
    expect(() => assertTransmissionRpcAllowed('session-stats')).not.toThrow();
    expect(() =>
      assertTransmissionRpcAllowed('torrent-get', { fields: [...TRANSMISSION_TORRENT_FIELDS] }),
    ).not.toThrow();

    expect(TRANSMISSION_ALLOWED_METHODS).toEqual(['session-get', 'session-stats', 'torrent-get']);
    expect(TRANSMISSION_TORRENT_FIELDS).toEqual(
      expect.arrayContaining(['eta', 'rateDownload', 'rateUpload', 'percentDone']),
    );

    const forbiddenMethods = [
      'torrent-start',
      'torrent-start-now',
      'torrent-stop',
      'torrent-remove',
      'torrent-set',
      'torrent-add',
      'session-set',
    ];
    for (const method of forbiddenMethods) {
      expect(() => assertTransmissionRpcAllowed(method)).toThrow(TransmissionClientError);
    }

    // 非白名单字段被拦截
    expect(() =>
      assertTransmissionRpcAllowed('torrent-get', { fields: ['id', 'magnetLink'] }),
    ).toThrow(TransmissionClientError);
    expect(() => assertTransmissionRpcAllowed('torrent-get', { fields: [] })).toThrow(
      TransmissionClientError,
    );

    expect(normalizeTransmissionRpcUrl('http://192.0.2.12:9091')).toBe(
      'http://192.0.2.12:9091/transmission/rpc',
    );
    expect(normalizeTransmissionRpcUrl('http://192.0.2.12:9091/transmission/rpc')).toBe(
      'http://192.0.2.12:9091/transmission/rpc',
    );
  });

  it('准确映射 Transmission 种子状态（0停止/1-2校验/3-4下载/5-6做种/error!=0/isStalled/速度0且peers0）', () => {
    const summary = buildTransmissionInstanceSummary({
      instance: {
        id: 'tr-1',
        name: 'TR 保种',
        type: 'transmission',
        url: 'http://192.0.2.12:9091',
        username: 'demo',
        tags: ['seed'],
        enabled: true,
        source: 'file',
        readonly: false,
      },
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: false,
      session: { version: '4.0.6' },
      stats: {
        uploadSpeed: 2048,
        downloadSpeed: 1024,
        'cumulative-stats': { uploadedBytes: 9000, downloadedBytes: 3000 },
      },
      torrents: [
        {
          id: 1,
          name: 'Stopped',
          status: 0,
          totalSize: 1000,
          percentDone: 0.5,
          rateDownload: 0,
          peersConnected: 0,
          error: 0,
          isStalled: false,
          trackers: [{ announce: 'https://tracker.alpha.example.com/announce' }],
          labels: ['archive'],
        },
        {
          id: 2,
          name: 'Checking',
          status: 2,
          totalSize: 1000,
          percentDone: 0.8,
          rateDownload: 0,
          peersConnected: 0,
          error: 0,
          isStalled: false,
          trackers: [{ announce: 'https://tracker.alpha.example.com/announce' }],
          labels: [],
        },
        {
          id: 3,
          name: 'Downloading Active',
          status: 4,
          totalSize: 2000,
          percentDone: 0.4,
          rateDownload: 512,
          peersConnected: 3,
          error: 0,
          isStalled: false,
          trackers: [{ announce: 'https://tracker.beta.example.com/announce' }],
          labels: ['temp'],
        },
        {
          id: 4,
          name: 'Downloading ZeroSpeedZeroPeers',
          status: 3,
          totalSize: 1500,
          percentDone: 0.1,
          rateDownload: 0,
          peersConnected: 0,
          error: 0,
          isStalled: false,
          trackers: [{ announce: 'https://tracker.beta.example.com/announce' }],
          labels: ['temp'],
        },
        {
          id: 5,
          name: 'Seeding Stalled',
          status: 6,
          totalSize: 3000,
          percentDone: 1,
          rateDownload: 0,
          peersConnected: 0,
          error: 0,
          isStalled: true,
          trackers: [{ announce: 'https://tracker.alpha.example.com/announce' }],
          labels: ['archive'],
        },
        {
          id: 6,
          name: 'Errored',
          status: 5,
          totalSize: 4000,
          percentDone: 1,
          rateDownload: 0,
          peersConnected: 0,
          error: 2,
          errorString: 'Tracker unregistered torrent',
          isStalled: false,
          trackers: [{ announce: 'https://tracker.alpha.example.com/announce' }],
          labels: ['archive'],
        },
      ],
    });

    expect(summary.counts).toEqual({
      seeding: 1,
      downloading: 2,
      paused: 1,
      error: 1,
      stalled: 2,
      total: 6,
    });
    expect(summary.totalSize).toBe(12500);
    expect(summary.ratio).toBe(3);
    expect(summary.byLabel?.map((l) => l.name)).toContain('archive');
    expect(summary.problems).toHaveLength(3); // ZeroSpeedZeroPeers + Seeding Stalled + Errored
    const erroredProblem = summary.problems.find((p) => p.name === 'Errored');
    expect(erroredProblem?.reason).toContain('Tracker unregistered torrent');
  });

  it('qB 与 TR 活跃任务筛选、中文状态映射、排序、eta 归一与 activeLimit 截断', () => {
    const qbSummary = buildQbitInstanceSummary({
      instance: {
        id: 'qb-1',
        name: 'qB 测试',
        type: 'qbittorrent',
        url: 'http://192.0.2.10:8080',
        username: 'demo',
        tags: ['download'],
        enabled: true,
        source: 'file',
        readonly: false,
      },
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: false,
      version: 'v5.0.2',
      transferInfo: { up_info_speed: 2000, dl_info_speed: 5000 },
      maindata: null,
      categories: {},
      activeLimit: 5,
      torrents: [
        {
          hash: 'idle-seed',
          name: 'Idle.Seeding',
          state: 'stalledUP',
          progress: 1,
          dlspeed: 0,
          upspeed: 0,
          eta: 8640000,
          size: 1000,
          ratio: 1.5,
          category: 'movies',
        },
        {
          hash: 'idle-paused',
          name: 'Idle.Paused',
          state: 'pausedDL',
          progress: 0.3,
          dlspeed: 0,
          upspeed: 0,
          eta: 8640000,
          size: 1000,
          ratio: 0.1,
        },
        {
          hash: 'active-seed',
          name: 'Active.Seeding',
          state: 'uploading',
          progress: 1,
          dlspeed: 0,
          upspeed: 900,
          eta: 8640000,
          size: 2000,
          ratio: 2.345,
          category: 'movies',
        },
        {
          hash: 'dl-slow',
          name: 'Downloading.Slow',
          state: 'forcedDL',
          progress: 0.25,
          dlspeed: 1000,
          upspeed: 200,
          eta: 4800,
          size: 3000,
          ratio: 0.05,
          category: 'tv',
        },
        {
          hash: 'dl-fast',
          name: 'Downloading.Fast',
          state: 'downloading',
          progress: 0.75,
          dlspeed: 4000,
          upspeed: 100,
          eta: 600,
          size: 4000,
          ratio: 0.2,
          category: 'movies',
        },
        {
          hash: 'meta',
          name: 'Meta.Fetching',
          state: 'metaDL',
          progress: 0,
          dlspeed: 0,
          upspeed: 0,
          eta: 8640000,
          size: 0,
          ratio: 0,
        },
        {
          hash: 'checking',
          name: 'Checking.Files',
          state: 'checkingDL',
          progress: 0.5,
          dlspeed: 0,
          upspeed: 0,
          eta: -1,
          size: 5000,
          ratio: 0,
        },
        {
          hash: 'err',
          name: 'Error.Task',
          state: 'missingFiles',
          progress: 1,
          dlspeed: 0,
          upspeed: 0,
          eta: 8640000,
          size: 6000,
          ratio: 1.0,
          category: 'movies',
        },
      ],
    });

    expect(qbSummary.activeTotal).toBe(6);
    expect(qbSummary.activeTasks).toHaveLength(5);
    expect(qbSummary.activeTasks.map((t) => [t.name, t.state, t.eta])).toEqual([
      ['Error.Task', '出错', null],
      ['Downloading.Fast', '下载中', 600],
      ['Downloading.Slow', '下载中', 4800],
      ['Checking.Files', '校验中', null],
      ['Meta.Fetching', '元数据', null],
    ]);
    expect(qbSummary.activeTasks[1]?.progress).toBe(0.75);
    expect(qbSummary.activeTasks[1]?.category).toBe('movies');

    const trSummary = buildTransmissionInstanceSummary({
      instance: {
        id: 'tr-1',
        name: 'TR 测试',
        type: 'transmission',
        url: 'http://192.0.2.12:9091',
        username: 'demo',
        tags: ['seed'],
        enabled: true,
        source: 'file',
        readonly: false,
      },
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: false,
      session: { version: '4.0.6' },
      stats: { uploadSpeed: 500, downloadSpeed: 1000 },
      torrents: [
        {
          id: 1,
          name: 'TR.Paused.Idle',
          status: 0,
          percentDone: 0.4,
          rateDownload: 0,
          rateUpload: 0,
          eta: -1,
          totalSize: 1000,
          uploadRatio: 0.1,
          error: 0,
          isStalled: false,
          labels: [],
        },
        {
          id: 2,
          name: 'TR.Seed.Idle',
          status: 6,
          percentDone: 1,
          rateDownload: 0,
          rateUpload: 0,
          eta: -2,
          totalSize: 2000,
          uploadRatio: 2,
          error: 0,
          isStalled: false,
          labels: ['archive'],
        },
        {
          id: 3,
          name: 'TR.Seed.Active',
          status: 6,
          percentDone: 1,
          rateDownload: 0,
          rateUpload: 500,
          eta: -1,
          totalSize: 3000,
          uploadRatio: 3.5,
          error: 0,
          isStalled: false,
          labels: ['remux'],
        },
        {
          id: 4,
          name: 'TR.Downloading',
          status: 4,
          percentDone: 0.6,
          rateDownload: 1000,
          rateUpload: 100,
          eta: 300,
          totalSize: 4000,
          uploadRatio: 0.25,
          error: 0,
          isStalled: false,
          peersConnected: 3,
          labels: ['hd'],
        },
        {
          id: 5,
          name: 'TR.Waiting',
          status: 3,
          percentDone: 0,
          rateDownload: 0,
          rateUpload: 0,
          eta: -2,
          totalSize: 5000,
          uploadRatio: 0,
          error: 0,
          isStalled: false,
          labels: [],
        },
        {
          id: 6,
          name: 'TR.Error',
          status: 4,
          percentDone: 0.2,
          rateDownload: 0,
          rateUpload: 0,
          eta: -1,
          totalSize: 6000,
          uploadRatio: 0,
          error: 2,
          isStalled: false,
          labels: ['bad'],
        },
      ],
    });

    expect(trSummary.activeTotal).toBe(4);
    expect(trSummary.activeTasks.map((t) => [t.name, t.state, t.eta, t.label])).toEqual([
      ['TR.Error', '出错', null, 'bad'],
      ['TR.Downloading', '下载中', 300, 'hd'],
      ['TR.Waiting', '等待', null, undefined],
      ['TR.Seed.Active', '做种中', null, 'remux'],
    ]);
  });
});

describe('多实例下载器存储加密、迁移与 API 行为', () => {
  let tempDir: string;
  let integrationsFile: string;
  let database: DatabaseConnection;
  let passwordHash: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homedash-dl-'));
    integrationsFile = path.join(tempDir, 'integrations.json');
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function loginCookie(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    return extractCookiePair(res.headers.get('set-cookie'));
  }

  it('PUT /api/downloaders 加密存储密码并校验 ID/URL/tags，GET 永不返回密码，支持空串保持与 null 清除', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
    });
    const app = createApp(config, database.db);
    const cookie = await loginCookie(app);

    const secretQb = 'fake-qb-secret-111';
    const secretTr = 'fake-tr-secret-222';

    // 非法 URL 校验
    const badUrlRes = await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qb-1',
            name: 'qB',
            type: 'qbittorrent',
            url: 'ftp://invalid.example.com',
            username: 'demo',
            tags: ['download'],
            enabled: true,
          },
        ],
      }),
    });
    expect(badUrlRes.status).toBe(400);

    // 非法 tags 校验
    const badTagRes = await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qb-1',
            name: 'qB',
            type: 'qbittorrent',
            url: 'http://192.0.2.10:8080',
            username: 'demo',
            tags: ['invalid-tag'],
            enabled: true,
          },
        ],
      }),
    });
    expect(badTagRes.status).toBe(400);

    // 重复 id 校验
    const dupIdRes = await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'dup-1',
            name: 'qB A',
            type: 'qbittorrent',
            url: 'http://192.0.2.10:8080',
            username: 'demo',
            tags: [],
            enabled: true,
          },
          {
            id: 'dup-1',
            name: 'qB B',
            type: 'qbittorrent',
            url: 'http://192.0.2.11:8080',
            username: 'demo',
            tags: [],
            enabled: true,
          },
        ],
      }),
    });
    expect(dupIdRes.status).toBe(400);

    // 正常保存
    const saveRes = await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qb-main',
            name: 'qB 下载',
            type: 'qbittorrent',
            url: 'http://192.0.2.10:8080',
            username: 'demo',
            password: secretQb,
            tags: ['download', 'brush'],
            enabled: true,
          },
          {
            id: 'tr-seed',
            name: 'TR 保种',
            type: 'transmission',
            url: 'http://192.0.2.12:9091',
            username: 'demo',
            password: secretTr,
            tags: ['seed'],
            enabled: true,
          },
        ],
      }),
    });
    expect(saveRes.status).toBe(200);
    const saveText = await saveRes.text();
    expect(saveText).not.toContain(secretQb);
    expect(saveText).not.toContain(secretTr);

    // 磁盘已加密，无明文
    const rawDisk = fs.readFileSync(integrationsFile, 'utf-8');
    expect(rawDisk).not.toContain(secretQb);
    expect(rawDisk).not.toContain(secretTr);
    const diskObj = JSON.parse(rawDisk) as {
      downloaders: Array<{ id: string; password?: { v: number; data: string } }>;
    };
    expect(diskObj.downloaders[0]?.password?.v).toBe(1);
    const prevQbCipher = diskObj.downloaders[0]?.password?.data;

    // GET 永不返回密码或密文
    const getRes = await app.request('/api/downloaders', { headers: { Cookie: cookie } });
    expect(getRes.status).toBe(200);
    const getText = await getRes.text();
    expect(getText).not.toContain(secretQb);
    expect(getText).not.toContain(prevQbCipher ?? 'never');
    const view = JSON.parse(getText) as DownloadersListResponse;
    expect(view.downloaders).toHaveLength(2);
    expect(view.downloaders[0]?.passwordSet).toBe(true);
    expect('password' in view.downloaders[0]!).toBe(false);

    // 空串保持原密码，null 清除密码
    const updateRes = await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qb-main',
            name: 'qB 下载',
            type: 'qbittorrent',
            url: 'http://192.0.2.10:8080',
            username: 'demo',
            password: '',
            tags: ['download'],
            enabled: true,
          },
          {
            id: 'tr-seed',
            name: 'TR 保种',
            type: 'transmission',
            url: 'http://192.0.2.12:9091',
            username: 'demo',
            password: null,
            tags: ['seed'],
            enabled: true,
          },
        ],
      }),
    });
    expect(updateRes.status).toBe(200);
    const updatedView = (await updateRes.json()) as DownloadersListResponse;
    expect(updatedView.downloaders[0]?.passwordSet).toBe(true);
    expect(updatedView.downloaders[1]?.passwordSet).toBe(false);
    const afterDisk = JSON.parse(fs.readFileSync(integrationsFile, 'utf-8')) as typeof diskObj;
    expect(afterDisk.downloaders[0]?.password?.data).toBe(prevQbCipher);
    expect(fs.existsSync(`${integrationsFile}.bak`)).toBe(true);
  });

  it('从旧版 env QBIT_* 与文件 qbittorrent 段自动迁移为 qbittorrent-default', async () => {
    // 1. env QBIT_* 迁移（只读且禁止修改返回 409）
    const envConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
      QBIT_URL: 'http://192.0.2.10:8080',
      QBIT_USERNAME: 'demo',
      QBIT_PASSWORD: 'fake-env-password',
    });
    const envApp = createApp(envConfig, database.db);
    const cookie1 = await loginCookie(envApp);

    const envListRes = await envApp.request('/api/downloaders', { headers: { Cookie: cookie1 } });
    const envList = (await envListRes.json()) as DownloadersListResponse;
    expect(envList.downloaders).toHaveLength(1);
    expect(envList.downloaders[0]).toMatchObject({
      id: 'qbittorrent-default',
      name: 'qBittorrent',
      type: 'qbittorrent',
      url: 'http://192.0.2.10:8080',
      passwordSet: true,
      source: 'env',
      readonly: true,
      readonlyReason: '由 .env 管理',
    });

    const conflictRes = await envApp.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qbittorrent-default',
            name: 'Modified',
            type: 'qbittorrent',
            url: 'http://192.0.2.99:8080',
            username: 'demo',
            tags: [],
            enabled: true,
          },
        ],
      }),
    });
    expect(conflictRes.status).toBe(409);

    // 2. 文件 qbittorrent 段迁移
    const fileConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
    });
    const fileApp = createApp(fileConfig, database.db);
    const cookie2 = await loginCookie(fileApp);
    await fileApp.request('/api/integrations/qbittorrent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
      body: JSON.stringify({
        url: 'http://192.0.2.50:8080',
        username: 'demo',
        password: 'fake-file-qbit-password',
      }),
    });

    const fileListRes = await fileApp.request('/api/downloaders', { headers: { Cookie: cookie2 } });
    const fileList = (await fileListRes.json()) as DownloadersListResponse;
    expect(fileList.downloaders).toHaveLength(1);
    expect(fileList.downloaders[0]).toMatchObject({
      id: 'qbittorrent-default',
      name: 'qBittorrent',
      type: 'qbittorrent',
      url: 'http://192.0.2.50:8080',
      passwordSet: true,
      source: 'file',
      readonly: false,
    });
  });

  it('Transmission 409 握手重试 + Basic 认证 + 方法字段白名单，qB 多实例 SID 隔离，并行汇总一台失败不影响其它', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
      DOWNLOADER_CACHE_SECONDS: '0',
    });

    const qbLogins: Record<string, number> = {};
    const qbSeenCookies: Record<string, string | null> = {};
    let tr409Count = 0;
    const trMethodsCalled: string[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      const headers = new Headers(init?.headers);

      // qB-1 (192.0.2.10) 在线
      if (parsed.hostname === '192.0.2.10') {
        if (parsed.pathname === '/api/v2/auth/login') {
          qbLogins['qb-1'] = (qbLogins['qb-1'] ?? 0) + 1;
          return new Response('Ok.', {
            status: 200,
            headers: { 'Set-Cookie': 'SID=sid-qb-1; path=/' },
          });
        }
        qbSeenCookies['qb-1'] = headers.get('Cookie');
        if (parsed.pathname === '/api/v2/app/version')
          return new Response('v5.0.2', { status: 200 });
        if (parsed.pathname === '/api/v2/transfer/info')
          return new Response(JSON.stringify({ up_info_speed: 3000, dl_info_speed: 1000 }));
        if (parsed.pathname === '/api/v2/sync/maindata')
          return new Response(
            JSON.stringify({
              server_state: { alltime_ul: 1000, alltime_dl: 500, global_ratio: '2.0' },
            }),
          );
        if (parsed.pathname === '/api/v2/torrents/info')
          return new Response(
            JSON.stringify([
              {
                hash: 'q1',
                name: 'QB1.Item',
                state: 'uploading',
                size: 5000,
                tracker: 'https://tracker.alpha.example.com/announce',
                category: 'movies',
                progress: 1,
                num_complete: 5,
                num_incomplete: 1,
              },
            ]),
          );
        if (parsed.pathname === '/api/v2/torrents/categories')
          return new Response(JSON.stringify({ movies: {} }));
      }

      // qB-2 (192.0.2.11) 连接失败（验证一台失败不影响其它 & 会话隔离）
      if (parsed.hostname === '192.0.2.11') {
        if (parsed.pathname === '/api/v2/auth/login') {
          qbLogins['qb-2'] = (qbLogins['qb-2'] ?? 0) + 1;
          return new Response('Ok.', {
            status: 200,
            headers: { 'Set-Cookie': 'SID=sid-qb-2; path=/' },
          });
        }
        qbSeenCookies['qb-2'] = headers.get('Cookie');
        throw new Error('network error');
      }

      // Transmission (192.0.2.12)
      if (parsed.hostname === '192.0.2.12') {
        expect(parsed.pathname).toBe('/transmission/rpc');
        expect(headers.get('Authorization')).toBe(
          `Basic ${Buffer.from('demo:fake-tr-pass').toString('base64')}`,
        );

        if (!headers.get('X-Transmission-Session-Id')) {
          tr409Count += 1;
          return new Response('409 Conflict', {
            status: 409,
            headers: { 'X-Transmission-Session-Id': 'tr-sess-123' },
          });
        }
        expect(headers.get('X-Transmission-Session-Id')).toBe('tr-sess-123');

        const rpcBody = JSON.parse(String(init?.body ?? '{}')) as {
          method: string;
          arguments?: { fields?: string[] };
        };
        trMethodsCalled.push(rpcBody.method);
        expect(TRANSMISSION_ALLOWED_METHODS).toContain(rpcBody.method);

        if (rpcBody.method === 'session-get') {
          return new Response(
            JSON.stringify({ result: 'success', arguments: { version: '4.0.5' } }),
          );
        }
        if (rpcBody.method === 'session-stats') {
          return new Response(
            JSON.stringify({
              result: 'success',
              arguments: {
                uploadSpeed: 7000,
                downloadSpeed: 500,
                'cumulative-stats': { uploadedBytes: 8000, downloadedBytes: 2000 },
              },
            }),
          );
        }
        if (rpcBody.method === 'torrent-get') {
          expect(rpcBody.arguments?.fields).toEqual([...TRANSMISSION_TORRENT_FIELDS]);
          return new Response(
            JSON.stringify({
              result: 'success',
              arguments: {
                torrents: [
                  {
                    id: 10,
                    name: 'TR.Seed',
                    status: 6,
                    totalSize: 9000,
                    percentDone: 1,
                    rateDownload: 0,
                    peersConnected: 4,
                    error: 0,
                    isStalled: false,
                    trackers: [{ announce: 'https://tracker.beta.example.com/announce' }],
                    labels: ['archive'],
                  },
                ],
              },
            }),
          );
        }
      }

      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, { fetchFn: fetchMock });
    const cookie = await loginCookie(app);

    await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qb-1',
            name: 'qB 主力',
            type: 'qbittorrent',
            url: 'http://192.0.2.10:8080',
            username: 'demo',
            password: 'fake-qb-pass-1',
            tags: ['download'],
            enabled: true,
          },
          {
            id: 'qb-2',
            name: 'qB 离线',
            type: 'qbittorrent',
            url: 'http://192.0.2.11:8080',
            username: 'demo',
            password: 'fake-qb-pass-2',
            tags: ['brush'],
            enabled: true,
          },
          {
            id: 'tr-1',
            name: 'TR 保种',
            type: 'transmission',
            url: 'http://192.0.2.12:9091',
            username: 'demo',
            password: 'fake-tr-pass',
            tags: ['seed'],
            enabled: true,
          },
        ],
      }),
    });

    const summaryRes = await app.request('/api/downloaders/summary', {
      headers: { Cookie: cookie },
    });
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as DownloadersSummaryResponse;

    expect(summary.configured).toBe(true);
    expect(summary.instances).toHaveLength(3);
    expect(summary.totals.totalInstances).toBe(3);
    expect(summary.totals.onlineInstances).toBe(2);
    expect(summary.totals.offlineInstances).toBe(1);
    expect(summary.totals.upSpeed).toBe(10000);
    expect(summary.totals.dlSpeed).toBe(1500);
    expect(summary.totals.counts.seeding).toBe(2);
    expect(summary.totals.totalSize).toBe(14000);

    expect(summary.instances[0]?.online).toBe(true);
    expect(summary.instances[1]?.online).toBe(false);
    expect(summary.instances[1]?.error).toContain('无法连接到 qBittorrent');
    expect(summary.instances[2]?.online).toBe(true);
    expect(summary.instances[2]?.version).toBe('4.0.5');

    // 验证 qB 会话隔离
    expect(qbSeenCookies['qb-1']).toBe('SID=sid-qb-1');
    expect(qbLogins['qb-1']).toBe(1);

    // 验证 Transmission 409 握手仅在首次无 session-id 时发生且仅调用白名单方法
    expect(tr409Count).toBeGreaterThanOrEqual(1);
    expect(trMethodsCalled).toEqual(
      expect.arrayContaining(['session-get', 'session-stats', 'torrent-get']),
    );
    expect(trMethodsCalled).not.toContain('torrent-start');
    expect(trMethodsCalled).not.toContain('torrent-stop');

    // 测试单个详情接口与 404
    const detailRes = await app.request('/api/downloaders/tr-1/summary', {
      headers: { Cookie: cookie },
    });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as DownloaderInstanceSummary;
    expect(detail.id).toBe('tr-1');
    expect(detail.byLabel?.[0]?.name).toBe('archive');

    const notFoundRes = await app.request('/api/downloaders/not-exists/summary', {
      headers: { Cookie: cookie },
    });
    expect(notFoundRes.status).toBe(404);

    // 测试 POST /api/downloaders/test 使用已存密码测试，不保存覆盖
    const testRes = await app.request('/api/downloaders/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        id: 'tr-1',
        type: 'transmission',
        url: 'http://192.0.2.12:9091',
        username: 'demo',
      }),
    });
    expect(testRes.status).toBe(200);
    const testBody = (await testRes.json()) as DownloaderTestResponse;
    expect(testBody.ok).toBe(true);
    expect(testBody.type).toBe('transmission');
    expect(testBody.version).toBe('4.0.5');
  });

  it('DOWNLOADERS_MOCK=true 返回 3 个模拟实例（qB 下载、qB 刷流、TR 保种）', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      DOWNLOADERS_MOCK: 'true',
    });
    const app = createApp(config, database.db);
    const cookie = await loginCookie(app);

    const res = await app.request('/api/downloaders/summary', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DownloadersSummaryResponse;
    expect(body.mock).toBe(true);
    expect(body.instances.map((i) => i.name)).toEqual(['qB 下载', 'qB 刷流', 'TR 保种']);
    expect(body.instances.map((i) => i.type)).toEqual([
      'qbittorrent',
      'qbittorrent',
      'transmission',
    ]);
    expect(body.instances[0]?.activeTotal).toBe(5);
    expect(body.instances[0]?.activeTasks.length).toBe(5);
  });

  it('GET /api/downloaders/:id/summary 支持 ?activeLimit=（1..100）且默认受 DOWNLOADER_ACTIVE_TASKS_LIMIT 控制', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
      DOWNLOADER_CACHE_SECONDS: '60',
      DOWNLOADER_ACTIVE_TASKS_LIMIT: '2',
    });

    const torrents = Array.from({ length: 6 }, (_, idx) => ({
      hash: `h-${idx}`,
      name: `Task.${idx}`,
      state: 'downloading',
      progress: 0.5,
      dlspeed: (6 - idx) * 1000,
      upspeed: 100,
      eta: 600 + idx * 60,
      size: 1024 * 1024,
      ratio: 0.1,
      category: 'movies',
    }));

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v2/auth/login') {
        return new Response('Ok.', {
          status: 200,
          headers: { 'Set-Cookie': 'SID=sid-qb-limit; path=/' },
        });
      }
      if (parsed.pathname === '/api/v2/app/version') return new Response('v5.0.2', { status: 200 });
      if (parsed.pathname === '/api/v2/transfer/info') {
        return new Response(JSON.stringify({ up_info_speed: 600, dl_info_speed: 21000 }));
      }
      if (parsed.pathname === '/api/v2/sync/maindata') {
        return new Response(JSON.stringify({ server_state: { alltime_ul: 100, alltime_dl: 100 } }));
      }
      if (parsed.pathname === '/api/v2/torrents/info') {
        return new Response(JSON.stringify(torrents));
      }
      if (parsed.pathname === '/api/v2/torrents/categories') {
        return new Response(JSON.stringify({ movies: {} }));
      }
      return new Response('Not Found', { status: 404 });
    });

    const app = createApp(config, database.db, { fetchFn: fetchMock });
    const cookie = await loginCookie(app);

    await app.request('/api/downloaders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        downloaders: [
          {
            id: 'qb-limit',
            name: 'qB 限流测试',
            type: 'qbittorrent',
            url: 'http://192.0.2.15:8080',
            username: 'demo',
            password: 'fake-password',
            tags: ['download'],
            enabled: true,
          },
        ],
      }),
    });

    // 默认按 DOWNLOADER_ACTIVE_TASKS_LIMIT=2 返回
    const defaultRes = await app.request('/api/downloaders/qb-limit/summary', {
      headers: { Cookie: cookie },
    });
    expect(defaultRes.status).toBe(200);
    const defaultBody = (await defaultRes.json()) as DownloaderInstanceSummary;
    expect(defaultBody.activeTotal).toBe(6);
    expect(defaultBody.activeTasks).toHaveLength(2);

    // 命中缓存时传入 ?activeLimit=5 仍可返回 5 条
    const customRes = await app.request('/api/downloaders/qb-limit/summary?activeLimit=5', {
      headers: { Cookie: cookie },
    });
    expect(customRes.status).toBe(200);
    const customBody = (await customRes.json()) as DownloaderInstanceSummary;
    expect(customBody.cached).toBe(true);
    expect(customBody.activeTotal).toBe(6);
    expect(customBody.activeTasks).toHaveLength(5);

    // 非法 activeLimit 返回 400
    for (const bad of ['0', '101', '-1', '1.5', 'abc']) {
      const badRes = await app.request(`/api/downloaders/qb-limit/summary?activeLimit=${bad}`, {
        headers: { Cookie: cookie },
      });
      expect(badRes.status).toBe(400);
    }
  });
});
