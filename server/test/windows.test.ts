import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  createWindowsStatusService,
  parseWindowsStatusOutput,
  WINDOWS_READONLY_STATUS_COMMAND,
  WINDOWS_READONLY_STATUS_SCRIPT,
  WindowsCollectorError,
  type WindowsCommandExecutor,
  type WindowsStatusResponse,
} from '../src/windows/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';
const TEST_KEY_CONTENT = 'test-private-key-placeholder-not-real';

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

const SAMPLE_POWERSHELL_JSON = JSON.stringify({
  hostname: 'HOME-PC',
  os: 'Microsoft Windows 11 Pro 10.0.22631',
  bootTime: '2026-11-24T00:00:00.0000000Z',
  uptimeSeconds: 266400,
  cpu: {
    model: 'Demo CPU 8-Core',
    loadPercent: 32.4,
  },
  memory: {
    totalBytes: 32 * 1024 ** 3,
    freeBytes: 16 * 1024 ** 3,
  },
  disks: [
    {
      drive: 'C:',
      label: '系统盘',
      totalBytes: 500 * 1024 ** 3,
      freeBytes: 100 * 1024 ** 3,
    },
    {
      drive: 'D:',
      label: '数据盘',
      totalBytes: 1000 * 1024 ** 3,
      freeBytes: 80 * 1024 ** 3,
    },
  ],
});

describe('Windows 只读采集命令与输出解析', () => {
  it('使用 -EncodedCommand 且仅包含 Get-CimInstance 只读查询', () => {
    expect(WINDOWS_READONLY_STATUS_COMMAND).toContain(
      'powershell -NoProfile -NonInteractive -EncodedCommand ',
    );
    const base64Part = WINDOWS_READONLY_STATUS_COMMAND.split('-EncodedCommand ')[1] ?? '';
    const decoded = Buffer.from(base64Part, 'base64').toString('utf16le');
    expect(decoded).toBe(WINDOWS_READONLY_STATUS_SCRIPT);
    expect(decoded).toContain('Get-CimInstance');
    expect(decoded).toContain('ConvertTo-Json');
    expect(decoded.toLowerCase()).not.toMatch(
      /\b(restart-computer|stop-computer|shutdown|set-content|out-file|remove-item)\b/,
    );
  });

  it('在脚本最开头设置当前进程输出编码为 UTF-8', () => {
    const utf8OutputSetting = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8';
    expect(WINDOWS_READONLY_STATUS_SCRIPT).toContain(utf8OutputSetting);
    expect(WINDOWS_READONLY_STATUS_SCRIPT.split('\n')[0]).toBe(utf8OutputSetting);

    const base64Part = WINDOWS_READONLY_STATUS_COMMAND.split('-EncodedCommand ')[1] ?? '';
    const decoded = Buffer.from(base64Part, 'base64').toString('utf16le');
    expect(decoded).toContain(utf8OutputSetting);
  });

  it('解析多磁盘与单磁盘对象输出并计算使用率', () => {
    const multi = parseWindowsStatusOutput(`\uFEFF${SAMPLE_POWERSHELL_JSON}\n`);
    expect(multi.hostname).toBe('HOME-PC');
    expect(multi.memory.usedPercent).toBe(50);
    expect(multi.disks).toHaveLength(2);
    expect(multi.disks[0]?.usedPercent).toBe(80);
    expect(multi.disks[1]?.usedPercent).toBe(92);

    const singleDiskPayload = JSON.stringify({
      ...JSON.parse(SAMPLE_POWERSHELL_JSON),
      disks: {
        drive: 'C:',
        label: '',
        totalBytes: 200,
        freeBytes: 50,
      },
    });
    const single = parseWindowsStatusOutput(singleDiskPayload);
    expect(single.disks).toHaveLength(1);
    expect(single.disks[0]?.usedPercent).toBe(75);
  });
});

describe('Windows 状态采集服务（可注入执行器 mock）', () => {
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
  });

  function makeWindowsConfig(overrides: Record<string, string | undefined> = {}) {
    return parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      WIN_SSH_HOST: '192.0.2.20',
      WIN_SSH_PORT: '22',
      WIN_SSH_USER: 'winuser',
      WIN_SSH_KEY_PATH: './secrets/test-win-key',
      WIN_SSH_TIMEOUT_MS: '8000',
      WIN_CACHE_SECONDS: '30',
      ...overrides,
    });
  }

  it('采集成功、命中缓存、过期重采及 ?refresh 跳过缓存', async () => {
    let currentTime = Date.parse('2026-11-27T08:00:00.000Z');
    const executor = vi.fn<WindowsCommandExecutor>().mockResolvedValue({
      code: 0,
      stdout: SAMPLE_POWERSHELL_JSON,
      stderr: '',
    });
    const service = createWindowsStatusService(makeWindowsConfig(), {
      executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
      now: () => currentTime,
    });

    const first = await service.getStatus();
    expect(first.online).toBe(true);
    expect(first.cached).toBe(false);
    expect(first.data?.hostname).toBe('HOME-PC');
    expect(executor).toHaveBeenCalledTimes(1);

    // 59 秒后仍在 >=60 秒下限缓存期内
    currentTime += 59_000;
    const cached = await service.getStatus();
    expect(cached.online).toBe(true);
    expect(cached.cached).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);

    // 强制刷新跳过缓存
    const refreshed = await service.getStatus({ refresh: true });
    expect(refreshed.online).toBe(true);
    expect(refreshed.cached).toBe(false);
    expect(executor).toHaveBeenCalledTimes(2);

    // 超过 60 秒后缓存过期
    currentTime += 61_000;
    const expired = await service.getStatus();
    expect(expired.cached).toBe(false);
    expect(executor).toHaveBeenCalledTimes(3);
  });

  it('WIN_CACHE_SECONDS=0 时仍下限钳制为至少缓存 60 秒', async () => {
    let currentTime = Date.parse('2026-11-27T08:00:00.000Z');
    const executor = vi.fn<WindowsCommandExecutor>().mockResolvedValue({
      code: 0,
      stdout: SAMPLE_POWERSHELL_JSON,
      stderr: '',
    });
    const service = createWindowsStatusService(makeWindowsConfig({ WIN_CACHE_SECONDS: '0' }), {
      executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
      now: () => currentTime,
    });

    const first = await service.getStatus();
    expect(first.cached).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);

    currentTime += 59_000;
    const cached = await service.getStatus();
    expect(cached.cached).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);

    currentTime += 2_000;
    const expired = await service.getStatus();
    expect(expired.cached).toBe(false);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('并发请求复用同一次进行中的采集', async () => {
    let resolveExec!: (val: { code: number; stdout: string; stderr: string }) => void;
    const executor = vi.fn<WindowsCommandExecutor>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExec = resolve;
        }),
    );

    const service = createWindowsStatusService(makeWindowsConfig(), {
      executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });

    const p1 = service.getStatus();
    const p2 = service.getStatus();
    const p3 = service.getStatus();

    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1));
    resolveExec({ code: 0, stdout: SAMPLE_POWERSHELL_JSON, stderr: '' });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.online).toBe(true);
    expect(r2.data?.hostname).toBe('HOME-PC');
    expect(r3.data?.hostname).toBe('HOME-PC');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('正确分类超时、认证失败、连接失败、密钥不可读、命令失败与解析失败，且失败缓存 10 秒', async () => {
    let currentTime = Date.parse('2026-11-27T08:00:00.000Z');

    // 超时与 10 秒失败冷却
    const timeoutExec = vi
      .fn<WindowsCommandExecutor>()
      .mockRejectedValue(new WindowsCollectorError('TIMEOUT', 'timed out'));
    const timeoutSvc = createWindowsStatusService(makeWindowsConfig(), {
      executor: timeoutExec,
      readPrivateKey: async () => TEST_KEY_CONTENT,
      now: () => currentTime,
    });

    const t1 = await timeoutSvc.getStatus();
    expect(t1.online).toBe(false);
    expect(t1.errorCode).toBe('TIMEOUT');
    expect(t1.error).toContain('超时');
    expect(timeoutExec).toHaveBeenCalledTimes(1);

    currentTime += 5_000;
    const t2 = await timeoutSvc.getStatus();
    expect(t2.cached).toBe(true);
    expect(timeoutExec).toHaveBeenCalledTimes(1);

    currentTime += 6_000;
    await timeoutSvc.getStatus();
    expect(timeoutExec).toHaveBeenCalledTimes(2);

    // 认证失败
    const authSvc = createWindowsStatusService(makeWindowsConfig(), {
      executor: vi
        .fn<WindowsCommandExecutor>()
        .mockRejectedValue(new WindowsCollectorError('AUTH_FAILED', 'auth failed')),
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });
    const authRes = await authSvc.getStatus();
    expect(authRes.errorCode).toBe('AUTH_FAILED');
    expect(authRes.error).toContain('认证失败');

    // 私钥文件不可读
    const keyErrSvc = createWindowsStatusService(makeWindowsConfig(), {
      executor: vi.fn<WindowsCommandExecutor>(),
      readPrivateKey: async () => {
        throw new Error('ENOENT');
      },
    });
    const keyRes = await keyErrSvc.getStatus();
    expect(keyRes.errorCode).toBe('KEY_FILE_ERROR');
    expect(keyRes.error).toContain('密钥文件不存在或不可读');

    // 命令执行非 0 退出码
    const cmdErrSvc = createWindowsStatusService(makeWindowsConfig(), {
      executor: vi.fn<WindowsCommandExecutor>().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'Access denied',
      }),
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });
    const cmdRes = await cmdErrSvc.getStatus();
    expect(cmdRes.errorCode).toBe('COMMAND_FAILED');
    expect(cmdRes.error).toContain('命令执行失败');

    // 输出解析失败
    const parseErrSvc = createWindowsStatusService(makeWindowsConfig(), {
      executor: vi.fn<WindowsCommandExecutor>().mockResolvedValue({
        code: 0,
        stdout: 'not json',
        stderr: '',
      }),
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });
    const parseRes = await parseErrSvc.getStatus();
    expect(parseRes.errorCode).toBe('PARSE_FAILED');
    expect(parseRes.error).toContain('解析失败');
  });

  it('WIN_MOCK=true 返回固定模拟数据且不调用执行器', async () => {
    const executor = vi.fn<WindowsCommandExecutor>();
    const mockCfg = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      WIN_MOCK: 'true',
    });
    const svc = createWindowsStatusService(mockCfg, { executor });
    const res = await svc.getStatus();

    expect(res.online).toBe(true);
    expect(res.data?.hostname).toBe('DEMO-PC');
    expect(res.data?.disks.length).toBeGreaterThan(0);
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('GET /api/windows/status HTTP 路由', () => {
  let database: DatabaseConnection;
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
  });

  it('需要登录，支持 ?refresh=1 且不泄露私钥内容或路径', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      WIN_SSH_HOST: '192.0.2.20',
      WIN_SSH_PORT: '22',
      WIN_SSH_USER: 'winuser',
      WIN_SSH_KEY_PATH: './secrets/very-secret-win-key-path',
    });

    const executor = vi.fn<WindowsCommandExecutor>().mockResolvedValue({
      code: 0,
      stdout: SAMPLE_POWERSHELL_JSON,
      stderr: '',
    });

    const app = createApp(config, database.db, {
      windowsExecutor: executor,
      readWindowsPrivateKey: async () => TEST_KEY_CONTENT,
    });

    const unauthRes = await app.request('/api/windows/status');
    expect(unauthRes.status).toBe(401);

    const cookie = await loginAndGetCookie(app);

    const firstRes = await app.request('/api/windows/status', {
      headers: { Cookie: cookie },
    });
    expect(firstRes.status).toBe(200);
    const firstText = await firstRes.text();
    expect(firstText).not.toContain(TEST_KEY_CONTENT);
    expect(firstText).not.toContain('very-secret-win-key-path');
    const firstJson = JSON.parse(firstText) as WindowsStatusResponse;
    expect(firstJson.online).toBe(true);
    expect(firstJson.cached).toBe(false);

    const cachedRes = await app.request('/api/windows/status', {
      headers: { Cookie: cookie },
    });
    const cachedJson = (await cachedRes.json()) as WindowsStatusResponse;
    expect(cachedJson.cached).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);

    const refreshRes = await app.request('/api/windows/status?refresh=1', {
      headers: { Cookie: cookie },
    });
    const refreshJson = (await refreshRes.json()) as WindowsStatusResponse;
    expect(refreshJson.cached).toBe(false);
    expect(executor).toHaveBeenCalledTimes(2);
  });
});
