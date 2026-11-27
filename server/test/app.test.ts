import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { parseConfig, type AppConfig, type ConfigStatusReport } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import { sessions } from '../src/db/schema.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

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

describe('密码哈希校验', () => {
  it('使用 scrypt 生成并校验密码哈希', async () => {
    const hashed = await hashPassword(TEST_PASSWORD);
    expect(hashed).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword(TEST_PASSWORD, hashed)).toBe(true);
    expect(await verifyPassword('wrong-password', hashed)).toBe(false);
    expect(await verifyPassword(TEST_PASSWORD, 'invalid-format')).toBe(false);
  });
});

describe('认证、会话过期、限流与配置状态接口', () => {
  let database: DatabaseConnection;
  let config: AppConfig;
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
    config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      SESSION_TTL_HOURS: '2',
      LOGIN_MAX_ATTEMPTS: '3',
      LOGIN_LOCK_MINUTES: '15',
    });
    database = createDatabase(config.app.DATABASE_URL);
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

  it('未登录访问 /api/auth/me、/api/settings/status 与其他受保护接口均返回 401', async () => {
    const app = createApp(config, database.db);

    const meRes = await app.request('/api/auth/me');
    expect(meRes.status).toBe(401);

    const statusRes = await app.request('/api/settings/status');
    expect(statusRes.status).toBe(401);

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

  it('登录成功设置签名 Cookie，/api/auth/me 返回 username 与 expiresAt，过期后返回 401 并清理会话', async () => {
    let currentTime = new Date('2026-01-01T00:00:00.000Z').getTime();
    const app = createApp(config, database.db, { now: () => currentTime });

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
    const expectedExpiresAt = new Date(
      currentTime + config.auth.SESSION_TTL_HOURS * 3600 * 1000,
    ).toISOString();
    expect(await meRes.json()).toEqual({
      username: TEST_USERNAME,
      expiresAt: expectedExpiresAt,
    });

    const tamperedRes = await app.request('/api/auth/me', {
      headers: { Cookie: `${cookiePair}tampered` },
    });
    expect(tamperedRes.status).toBe(401);

    // 推进时间超过 SESSION_TTL_HOURS（2 小时）
    currentTime += 2 * 3600 * 1000 + 1000;
    const expiredRes = await app.request('/api/auth/me', {
      headers: { Cookie: cookiePair },
    });
    expect(expiredRes.status).toBe(401);

    // 验证过期会话已从数据库中清理
    const remainingSessions = database.db.select().from(sessions).all();
    expect(remainingSessions).toHaveLength(0);
  });

  it('登出后会话失效返回 401', async () => {
    const app = createApp(config, database.db);

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const cookiePair = extractCookiePair(loginRes.headers.get('set-cookie'));

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

  it('连续错误登录触发 429 锁定，锁定期内正确密码也被拒，解锁及成功登录后计数清零', async () => {
    let currentTime = new Date('2026-01-01T00:00:00.000Z').getTime();
    const app = createApp(config, database.db, { now: () => currentTime });

    for (let i = 0; i < 3; i += 1) {
      const failRes = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `192.0.2.${10 + i}`,
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong-password' }),
      });
      // TRUST_PROXY 默认为 false，不同 X-Forwarded-For 仍归为同一连接来源
      expect(failRes.status).toBe(401);
    }

    const lockedWrongRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.0.2.99',
      },
      body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong-password' }),
    });
    expect(lockedWrongRes.status).toBe(429);
    expect(lockedWrongRes.headers.get('Retry-After')).toBeTruthy();
    const lockedBody = (await lockedWrongRes.json()) as { error: string };
    expect(lockedBody.error).toContain('15 分钟');

    // 锁定期内使用正确密码同样被拒绝
    const lockedCorrectRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    expect(lockedCorrectRes.status).toBe(429);

    // 推进超过 15 分钟锁定期后恢复允许登录，且成功登录后错误计数清零
    currentTime += 15 * 60_000 + 1000;

    // 先错 2 次再成功登录，确认成功登录后清零
    for (let i = 0; i < 2; i += 1) {
      const preSuccessFail = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong-password' }),
      });
      expect(preSuccessFail.status).toBe(401);
    }

    const successRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    expect(successRes.status).toBe(200);

    // 成功登录后重新计数，再错 1 次应返回 401 而非 429
    const afterResetFail = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong-password' }),
    });
    expect(afterResetFail.status).toBe(401);
  });

  it('TRUST_PROXY=true 时按 X-Forwarded-For 区分客户端 IP', async () => {
    const proxyConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      TRUST_PROXY: 'true',
      LOGIN_MAX_ATTEMPTS: '2',
      LOGIN_LOCK_MINUTES: '10',
    });
    const app = createApp(proxyConfig, database.db);

    for (let i = 0; i < 2; i += 1) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.0.2.10',
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong-password' }),
      });
      expect(res.status).toBe(401);
    }

    const blockedIpRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.0.2.10',
      },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    expect(blockedIpRes.status).toBe(429);

    const otherIpRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.0.2.20',
      },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    expect(otherIpRes.status).toBe(200);
  });

  it('GET /api/settings/status 登录后返回模块状态且响应体绝不含任何测试密钥值', async () => {
    const richConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      QBIT_URL: 'http://192.0.2.10:8080',
      QBIT_USERNAME: 'qbituser',
      QBIT_PASSWORD: 'fake-qbit-password-999',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token-888',
    });

    const app = createApp(richConfig, database.db);
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const cookiePair = extractCookiePair(loginRes.headers.get('set-cookie'));

    const statusRes = await app.request('/api/settings/status', {
      headers: { Cookie: cookiePair },
    });
    expect(statusRes.status).toBe(200);

    const rawText = await statusRes.text();
    const payload = JSON.parse(rawText) as ConfigStatusReport;

    expect(payload.modules.app.status).toBe('configured');
    expect(payload.modules.auth.status).toBe('configured');
    expect(payload.modules.qbittorrent.status).toBe('configured');
    expect(payload.modules.qbittorrent.keys.QBIT_PASSWORD).toBe(true);
    expect(payload.modules.moviepilot.status).toBe('configured');
    expect(payload.modules.nas.status).toBe('unconfigured');
    expect(payload.modules.windows.status).toBe('unconfigured');
    expect(payload.modules.vps.status).toBe('unconfigured');

    expect(rawText).not.toContain(TEST_SESSION_SECRET);
    expect(rawText).not.toContain(passwordHash);
    expect(rawText).not.toContain('fake-qbit-password-999');
    expect(rawText).not.toContain('fake-mp-token-888');
    expect(rawText).not.toContain('192.0.2.10');
    expect(rawText).not.toContain('mp.example.com');
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
        app: {
          ...config.app,
          NODE_ENV: 'production',
          WEB_DIST_DIR: tmpDistDir,
        },
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
