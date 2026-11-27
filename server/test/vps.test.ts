import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  calculateDaysLeft,
  calculateVpsLevel,
  readVpsList,
  type VpsListResponse,
} from '../src/vps/service.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

async function loginAndGetCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('缺少 Set-Cookie');
  return setCookie.split(';')[0] ?? '';
}

describe('VPS 天数与告警等级计算', () => {
  it('按 Asia/Shanghai 与 UTC 时区边界精确计算剩余天数', () => {
    // 2026-11-27T16:30:00Z -> UTC 为 2026-11-27，Asia/Shanghai 为 2026-11-28 00:30
    const boundaryUtcMs = Date.parse('2026-11-27T16:30:00.000Z');

    expect(calculateDaysLeft('2026-11-28', boundaryUtcMs, 'Asia/Shanghai')).toBe(0);
    expect(calculateDaysLeft('2026-11-28', boundaryUtcMs, 'UTC')).toBe(1);
    expect(calculateDaysLeft('2026-11-27', boundaryUtcMs, 'Asia/Shanghai')).toBe(-1);
    expect(calculateDaysLeft('2026-11-27', boundaryUtcMs, 'UTC')).toBe(0);
  });

  it('正确划分 expired / danger / warning / ok 四个告警等级', () => {
    expect(calculateVpsLevel(-1)).toBe('expired');
    expect(calculateVpsLevel(0)).toBe('danger');
    expect(calculateVpsLevel(7)).toBe('danger');
    expect(calculateVpsLevel(8)).toBe('warning');
    expect(calculateVpsLevel(30)).toBe('warning');
    expect(calculateVpsLevel(31)).toBe('ok');
  });
});

describe('VPS 清单读取、保存与鉴权接口', () => {
  let database: DatabaseConnection;
  let passwordHash: string;
  let tmpDir: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homedash-vps-test-'));
  });

  afterEach(() => {
    database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Record<string, string | undefined> = {}) {
    return parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      ...overrides,
    });
  }

  it('未登录访问 GET /api/vps 与 PUT /api/vps 均返回 401', async () => {
    const app = createApp(makeConfig(), database.db);

    const getRes = await app.request('/api/vps');
    expect(getRes.status).toBe(401);

    const putRes = await app.request('/api/vps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: [] }),
    });
    expect(putRes.status).toBe(401);
  });

  it('未配置、文件不存在与 JSON 解析失败时返回中文错误且不泄露敏感信息', () => {
    const unconfigured = readVpsList(makeConfig());
    expect(unconfigured.configured).toBe(false);
    expect(unconfigured.errorCode).toBe('UNCONFIGURED');
    expect(unconfigured.error).toContain('未配置');

    const missingPath = path.join(tmpDir, 'missing.json');
    const missing = readVpsList(makeConfig({ VPS_LIST_FILE: missingPath }));
    expect(missing.configured).toBe(true);
    expect(missing.errorCode).toBe('FILE_NOT_FOUND');
    expect(missing.error).toContain('不存在');
    expect(missing.error).not.toContain(tmpDir);

    const badJsonPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badJsonPath, '{ invalid json', 'utf-8');
    const badJson = readVpsList(makeConfig({ VPS_LIST_FILE: badJsonPath }));
    expect(badJson.errorCode).toBe('INVALID_JSON');
    expect(badJson.error).toContain('JSON 解析失败');
  });

  it('单条日期格式错误时仅标记该条目，不影响其他正常条目计算与汇总', async () => {
    const filePath = path.join(tmpDir, 'vps.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        servers: [
          { id: 'v1', name: '节点一', expiresAt: '2026-11-25' },
          { id: 'v2', name: '错误日期节点', expiresAt: '2026-02-30' },
          { id: 'v3', name: '节点三', expiresAt: '2026-12-02', price: 29, currency: 'CNY' },
          { id: 'v4', name: '节点四', expiresAt: '2026-12-20' },
          { id: 'v5', name: '节点五', expiresAt: '2027-03-01' },
        ],
      }),
      'utf-8',
    );

    const nowMs = Date.parse('2026-11-27T04:00:00.000Z'); // Asia/Shanghai 2026-11-27 12:00
    const app = createApp(makeConfig({ VPS_LIST_FILE: filePath }), database.db, {
      now: () => nowMs,
    });
    const cookie = await loginAndGetCookie(app);

    const res = await app.request('/api/vps', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as VpsListResponse;

    expect(body.configured).toBe(true);
    expect(body.timezone).toBe('Asia/Shanghai');
    expect(body.summary).toEqual({
      total: 5,
      expired: 1,
      within7Days: 1,
      within30Days: 2,
      invalid: 1,
    });

    expect(body.servers[0]?.level).toBe('expired');
    expect(body.servers[0]?.daysLeft).toBe(-2);
    expect(body.servers[1]?.level).toBeNull();
    expect(body.servers[1]?.daysLeft).toBeNull();
    expect(body.servers[1]?.error).toContain('YYYY-MM-DD');
    expect(body.servers[2]?.level).toBe('danger');
    expect(body.servers[2]?.daysLeft).toBe(5);
    expect(body.servers[3]?.level).toBe('warning');
    expect(body.servers[4]?.level).toBe('ok');
  });

  it('PUT /api/vps 校验并原子保存清单且保留 .bak 备份', async () => {
    const filePath = path.join(tmpDir, 'vps.json');
    const initialContent = JSON.stringify({
      servers: [{ id: 'old-1', name: '旧节点', expiresAt: '2026-12-01' }],
    });
    fs.writeFileSync(filePath, initialContent, 'utf-8');

    const nowMs = Date.parse('2026-11-27T04:00:00.000Z');
    const app = createApp(makeConfig({ VPS_LIST_FILE: filePath }), database.db, {
      now: () => nowMs,
    });
    const cookie = await loginAndGetCookie(app);

    // 非法日期被拒绝且不覆盖原文件
    const invalidRes = await app.request('/api/vps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        servers: [{ name: '非法节点', expiresAt: '2026-99-99' }],
      }),
    });
    expect(invalidRes.status).toBe(400);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(initialContent);

    // 正常保存并生成 .bak 备份
    const validRes = await app.request('/api/vps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        servers: [
          {
            name: '新节点 A',
            provider: 'Example Cloud',
            expiresAt: '2026-12-10',
            price: 39.9,
            currency: 'CNY',
            renewUrl: 'https://billing.example.com/renew/a',
            note: '测试备注',
          },
        ],
      }),
    });
    expect(validRes.status).toBe(200);
    const saved = (await validRes.json()) as VpsListResponse;
    expect(saved.servers).toHaveLength(1);
    expect(saved.servers[0]?.name).toBe('新节点 A');
    expect(saved.servers[0]?.daysLeft).toBe(13);
    expect(saved.servers[0]?.level).toBe('warning');

    expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${filePath}.bak`, 'utf-8')).toBe(initialContent);
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      servers: Array<{ name: string; id: string }>;
    };
    expect(persisted.servers[0]?.name).toBe('新节点 A');
    expect(persisted.servers[0]?.id).toBeTruthy();
  });

  it('未配置 VPS_LIST_FILE 返回 400，只读模式 VPS_READONLY=true 返回 403', async () => {
    const unconfiguredApp = createApp(makeConfig(), database.db);
    const unconfiguredCookie = await loginAndGetCookie(unconfiguredApp);
    const res400 = await unconfiguredApp.request('/api/vps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: unconfiguredCookie },
      body: JSON.stringify({ servers: [] }),
    });
    expect(res400.status).toBe(400);

    const filePath = path.join(tmpDir, 'readonly.json');
    fs.writeFileSync(filePath, JSON.stringify({ servers: [] }), 'utf-8');
    const readonlyApp = createApp(
      makeConfig({ VPS_LIST_FILE: filePath, VPS_READONLY: 'true' }),
      database.db,
    );
    const readonlyCookie = await loginAndGetCookie(readonlyApp);
    const res403 = await readonlyApp.request('/api/vps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: readonlyCookie },
      body: JSON.stringify({ servers: [{ name: '测试', expiresAt: '2026-12-31' }] }),
    });
    expect(res403.status).toBe(403);
    const errBody = (await res403.json()) as { error: string };
    expect(errBody.error).toContain('只读模式');
  });
});
