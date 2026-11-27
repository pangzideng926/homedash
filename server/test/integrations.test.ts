import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig, type ConfigStatusReport } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  decryptSecret,
  deriveIntegrationKey,
  encryptSecret,
  INTEGRATIONS_HKDF_INFO,
  IntegrationsCryptoError,
} from '../src/integrations/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';
const TEST_ENC_KEY = 'test-config-encryption-key-0123456789';

function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error('缺少 Set-Cookie');
  }
  return setCookieHeader.split(';')[0] ?? '';
}

describe('集成凭据加解密与 HKDF 密钥派生', () => {
  it('支持 CONFIG_ENCRYPTION_KEY 与 SESSION_SECRET HKDF-SHA256 派生，每次加密生成独立随机 IV 且能检测篡改', () => {
    expect(INTEGRATIONS_HKDF_INFO).toBe('homedash-integrations-v1');

    const keyFromSession = deriveIntegrationKey({ sessionSecret: TEST_SESSION_SECRET });
    const keyFromSession2 = deriveIntegrationKey({ sessionSecret: TEST_SESSION_SECRET });
    const keyFromExplicit = deriveIntegrationKey({
      configEncryptionKey: TEST_ENC_KEY,
      sessionSecret: TEST_SESSION_SECRET,
    });

    expect(keyFromSession).toHaveLength(32);
    expect(keyFromSession.equals(keyFromSession2)).toBe(true);
    expect(keyFromExplicit.equals(keyFromSession)).toBe(false);

    const secret = 'fake-qbit-secret-password';
    const enc1 = encryptSecret(secret, keyFromSession);
    const enc2 = encryptSecret(secret, keyFromSession);

    expect(enc1.v).toBe(1);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.data).not.toBe(enc2.data);
    expect(decryptSecret(enc1, keyFromSession)).toBe(secret);
    expect(decryptSecret(enc2, keyFromSession)).toBe(secret);

    // 篡改密文或认证标签应报错且绝不泄露明文
    const tamperedData = {
      ...enc1,
      data: Buffer.from('tampered-cipher-bytes').toString('base64'),
    };
    expect(() => decryptSecret(tamperedData, keyFromSession)).toThrow(IntegrationsCryptoError);

    const tamperedTag = {
      ...enc1,
      tag: Buffer.alloc(16, 0xff).toString('base64'),
    };
    expect(() => decryptSecret(tamperedTag, keyFromSession)).toThrow(IntegrationsCryptoError);

    // 使用错误密钥解密失败
    expect(() => decryptSecret(enc1, keyFromExplicit)).toThrow(IntegrationsCryptoError);
  });
});

describe('集成凭据存储 API（/api/integrations 与 /api/settings/status）', () => {
  let tempDir: string;
  let integrationsFile: string;
  let database: DatabaseConnection;
  let passwordHash: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homedash-int-'));
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

  it('PUT 加密保存并生成 .bak，GET 仅返回非敏感值且绝不泄露敏感明文或密文，支持空串保留与 null 清除', async () => {
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

    const secretPass = 'fake-qbit-password-secret-123';
    const secretToken = 'fake-mp-api-token-secret-456';

    // 1. 保存 qBittorrent 与 MoviePilot
    const saveQbit = await app.request('/api/integrations/qbittorrent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'http://192.0.2.10:8080',
        username: 'demo',
        password: secretPass,
      }),
    });
    expect(saveQbit.status).toBe(200);
    const saveQbitText = await saveQbit.text();
    expect(saveQbitText).not.toContain(secretPass);

    const saveMp = await app.request('/api/integrations/moviepilot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'https://mp.example.com',
        apiToken: secretToken,
      }),
    });
    expect(saveMp.status).toBe(200);
    expect(fs.existsSync(`${integrationsFile}.bak`)).toBe(true);

    // 验证磁盘上敏感字段已加密，明文不存在
    const rawDisk = fs.readFileSync(integrationsFile, 'utf-8');
    expect(rawDisk).not.toContain(secretPass);
    expect(rawDisk).not.toContain(secretToken);
    const parsedDisk = JSON.parse(rawDisk) as {
      qbittorrent: {
        url: string;
        username: string;
        password: { v: number; iv: string; tag: string; data: string };
      };
      moviepilot: { url: string; apiToken: { v: number; iv: string; tag: string; data: string } };
    };
    expect(parsedDisk.qbittorrent.url).toBe('http://192.0.2.10:8080');
    expect(parsedDisk.qbittorrent.password.v).toBe(1);
    expect(parsedDisk.moviepilot.apiToken.v).toBe(1);

    // 2. GET /api/integrations 绝不返回明文或密文
    const getRes = await app.request('/api/integrations', {
      headers: { Cookie: cookie },
    });
    expect(getRes.status).toBe(200);
    const getText = await getRes.text();
    expect(getText).not.toContain(secretPass);
    expect(getText).not.toContain(secretToken);
    expect(getText).not.toContain(parsedDisk.qbittorrent.password.data);
    expect(getText).not.toContain(parsedDisk.moviepilot.apiToken.data);

    const view = JSON.parse(getText) as {
      modules: {
        qbittorrent: {
          configured: boolean;
          fields: {
            url: { source: string; set: boolean; value?: string };
            password: { source: string; set: boolean; value?: unknown };
          };
        };
      };
    };
    expect(view.modules.qbittorrent.configured).toBe(true);
    expect(view.modules.qbittorrent.fields.url).toEqual({
      source: 'file',
      set: true,
      value: 'http://192.0.2.10:8080',
    });
    expect(view.modules.qbittorrent.fields.password).toEqual({
      source: 'file',
      set: true,
    });
    expect('value' in view.modules.qbittorrent.fields.password).toBe(false);

    // 3. GET /api/settings/status 综合 file 状态
    const statusRes = await app.request('/api/settings/status', {
      headers: { Cookie: cookie },
    });
    const statusBody = (await statusRes.json()) as ConfigStatusReport;
    expect(statusBody.modules.qbittorrent.status).toBe('configured');
    expect(statusBody.modules.moviepilot.status).toBe('configured');

    // 4. PUT 敏感字段传空字符串保持不变
    const keepRes = await app.request('/api/integrations/qbittorrent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'http://192.0.2.11:8080',
        password: '',
      }),
    });
    expect(keepRes.status).toBe(200);
    const afterKeepDisk = JSON.parse(
      fs.readFileSync(integrationsFile, 'utf-8'),
    ) as typeof parsedDisk;
    expect(afterKeepDisk.qbittorrent.url).toBe('http://192.0.2.11:8080');
    expect(afterKeepDisk.qbittorrent.password.data).toBe(parsedDisk.qbittorrent.password.data);

    // 5. PUT 敏感字段传 null 清除
    const clearRes = await app.request('/api/integrations/qbittorrent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ password: null }),
    });
    expect(clearRes.status).toBe(200);
    const clearView = JSON.parse(await clearRes.text()) as typeof view;
    expect(clearView.modules.qbittorrent.configured).toBe(false);
    expect(clearView.modules.qbittorrent.fields.password).toEqual({
      source: 'unset',
      set: false,
    });
  });

  it('.env 优先级高于文件，修改 .env 管理的字段返回 409 中文提示', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
      NAS_SSH_HOST: '192.0.2.99',
      QBIT_PASSWORD: 'fake-env-qbit-password',
    });
    const app = createApp(config, database.db);
    const cookie = await loginCookie(app);

    const getRes = await app.request('/api/integrations', {
      headers: { Cookie: cookie },
    });
    const view = (await getRes.json()) as {
      modules: {
        nas: { fields: { host: { source: string; set: boolean; value?: string } } };
        qbittorrent: { fields: { password: { source: string; set: boolean } } };
      };
    };
    expect(view.modules.nas.fields.host).toEqual({
      source: 'env',
      set: true,
      value: '192.0.2.99',
    });
    expect(view.modules.qbittorrent.fields.password).toEqual({
      source: 'env',
      set: true,
    });

    // 试图修改 .env 管理的字段应返回 409
    const conflictNas = await app.request('/api/integrations/nas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ host: '192.0.2.100' }),
    });
    expect(conflictNas.status).toBe(409);
    expect(((await conflictNas.json()) as { error: string }).error).toContain('该项由 .env 管理');

    const conflictQbitPass = await app.request('/api/integrations/qbittorrent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ password: 'new-password' }),
    });
    expect(conflictQbitPass.status).toBe(409);
    expect(((await conflictQbitPass.json()) as { error: string }).error).toContain(
      '该项由 .env 管理',
    );

    // 未修改 .env 密码字段（省略或空串），仅保存其它未在 .env 设置的字段允许通过
    const okQbit = await app.request('/api/integrations/qbittorrent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: 'http://192.0.2.10:8080', username: 'demo', password: '' }),
    });
    expect(okQbit.status).toBe(200);
  });

  it('POST /api/integrations/:module/test 使用“请求体覆盖 + 已存值”测试连接且不保存', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ download_speed: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = createApp(config, database.db, { fetchFn: fetchMock });
    const cookie = await loginCookie(app);

    // 先保存 URL，未保存 token
    await app.request('/api/integrations/moviepilot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: 'https://mp.example.com' }),
    });

    // 测试连接时仅在请求体覆盖 apiToken
    const testRes = await app.request('/api/integrations/moviepilot/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ apiToken: 'fake-temp-token-123' }),
    });
    expect(testRes.status).toBe(200);
    const testBody = (await testRes.json()) as { ok: boolean; durationMs: number };
    expect(testBody.ok).toBe(true);
    expect(typeof testBody.durationMs).toBe('number');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 确认临时 token 未被保存到磁盘
    const rawDisk = fs.readFileSync(integrationsFile, 'utf-8');
    expect(rawDisk).not.toContain('fake-temp-token-123');
    const getRes = await app.request('/api/integrations', {
      headers: { Cookie: cookie },
    });
    const view = (await getRes.json()) as {
      modules: { moviepilot: { fields: { apiToken: { set: boolean } } } };
    };
    expect(view.modules.moviepilot.fields.apiToken.set).toBe(false);
  });
});
