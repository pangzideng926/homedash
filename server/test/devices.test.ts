import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  createDevicesService,
  LEGACY_READONLY_REASON,
  LINUX_READONLY_STATUS_COMMAND,
  LINUX_READONLY_STATUS_SCRIPT,
  MACOS_READONLY_STATUS_COMMAND,
  MACOS_READONLY_STATUS_SCRIPT,
  parseLinuxDeviceOutput,
  parseMacosDeviceOutput,
  parseWindowsDeviceOutput,
  resolveEffectiveCacheSeconds,
  SshCollectorError,
  UNIX_OS_PROBE_COMMAND,
  WINDOWS_OS_PROBE_COMMAND,
  WINDOWS_OS_PROBE_SCRIPT,
  WINDOWS_READONLY_STATUS_SCRIPT,
  type DeviceListResponse,
  type DevicesStatusResponse,
  type DeviceStatusItem,
  type DeviceTestResponse,
  type SshCommandExecutor,
} from '../src/devices/index.js';

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

const SAMPLE_WINDOWS_STDOUT = JSON.stringify({
  hostname: 'DEMO-WIN',
  os: 'Microsoft Windows 11 Pro 10.0.22631',
  bootTime: '2026-11-24T00:00:00.0000000Z',
  uptimeSeconds: 266400,
  cpu: {
    model: 'Demo CPU 12-Core',
    cores: 12,
    loadPercent: 28.5,
  },
  memory: {
    totalBytes: 32 * 1024 ** 3,
    freeBytes: 16 * 1024 ** 3,
    usedBytes: 16 * 1024 ** 3,
  },
  disks: [
    {
      mount: 'C:',
      label: '系统盘',
      totalBytes: 500 * 1024 ** 3,
      freeBytes: 100 * 1024 ** 3,
    },
  ],
});

const SAMPLE_MACOS_STDOUT = [
  'HOSTNAME=DEMO-MAC',
  'OS_PRODUCT=macOS',
  'OS_VERSION=15.1',
  'OS_BUILD=24B83',
  'BOOTTIME={ sec = 1763942400, usec = 0 } Tue Nov 24 00:00:00 2026',
  'NOW_EPOCH=1764201600',
  'CPU_MODEL=Apple M2 Pro (Demo)',
  'CPU_CORES=10',
  'MEM_TOTAL=17179869184',
  '===VM_STAT===',
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                               12000.',
  'Pages active:                            320000.',
  'Pages inactive:                          180000.',
  'Pages speculative:                         5000.',
  'Pages throttled:                              0.',
  'Pages wired down:                        120000.',
  'Pages occupied by compressor:             80000.',
  '===TOP===',
  'Processes: 412 total, 2 running, 410 sleeping, 2000 threads',
  'CPU usage: 12.3% user, 6.2% sys, 81.5% idle',
  '===DF===',
  'Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on',
  '/dev/disk3s1s1 482797652  10485760 200000000     5%  400000 2000000000    0%   /',
  'devfs                204       204         0   100%     700          0  100%   /dev',
  '/dev/disk3s6   482797652   2097152 200000000     2%       1 2000000000    0%   /System/Volumes/VM',
  '/dev/disk3s5   482797652 260000000 200000000    57% 1200000 2000000000    0%   /System/Volumes/Data',
  '/dev/disk4s1   976762584 781410000 195352584    80%  500000  100000000    1%   /Volumes/My Drive',
  '===END===',
].join('\n');

const SAMPLE_LINUX_STDOUT = [
  'HOSTNAME=demo-linux',
  'NOW_EPOCH=1764201600',
  'UPTIME=172800.45 340000.12',
  'CPU_CORES=8',
  'CPU_MODEL=Demo Linux EPYC 8-Core',
  'LOADAVG=1.60 1.20 0.90 2/256 1234',
  'CPU_STAT_1=cpu  1000 0 500 8500 0 0 0 0 0 0',
  'CPU_STAT_2=cpu  1200 0 600 9200 0 0 0 0 0 0',
  '===OS_RELEASE===',
  'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"',
  'NAME="Debian GNU/Linux"',
  '===MEMINFO===',
  'MemTotal:       16384000 kB',
  'MemFree:         2048000 kB',
  'MemAvailable:    8192000 kB',
  'Buffers:          512000 kB',
  'Cached:          4096000 kB',
  '===DF===',
  'Filesystem     Type     1024-blocks      Used Available Capacity Mounted on',
  'udev           devtmpfs     8000000         0   8000000       0% /dev',
  'tmpfs          tmpfs        1638400      2048   1636352       1% /run',
  'overlay        overlay    104857600  41943040  62914560      40% /var/lib/docker/overlay2/abc/merged',
  '/dev/nvme0n1p2 ext4       104857600  41943040  62914560      40% /',
  '/dev/sda1      ext4       209715200 188743680  20971520      90% /mnt/media',
  '===END===',
].join('\n');

describe('只读脚本安全与多系统输出解析', () => {
  it('三条采集脚本常量均为严格只读且不含危险修改命令', () => {
    for (const script of [
      WINDOWS_READONLY_STATUS_SCRIPT,
      MACOS_READONLY_STATUS_SCRIPT,
      LINUX_READONLY_STATUS_SCRIPT,
    ]) {
      expect(script.toLowerCase()).not.toMatch(
        /\b(restart-computer|stop-computer|shutdown|reboot|poweroff|mkfs|rm\s+-rf|apt-get|brew\s+install|out-file|set-content)\b/,
      );
    }
    expect(MACOS_READONLY_STATUS_COMMAND).toContain('/bin/sh -c');
    expect(LINUX_READONLY_STATUS_COMMAND).toContain('/bin/sh -c');
    expect(MACOS_READONLY_STATUS_SCRIPT).not.toContain("'");
    expect(LINUX_READONLY_STATUS_SCRIPT).not.toContain("'");
  });

  it('Windows 系统识别命令使用 -EncodedCommand、不含字面量 $PSVersionTable 且解码后等于只读脚本', () => {
    expect(WINDOWS_OS_PROBE_COMMAND).toContain(
      'powershell -NoProfile -NonInteractive -EncodedCommand ',
    );
    expect(WINDOWS_OS_PROBE_COMMAND).toMatch(
      /^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
    );
    expect(WINDOWS_OS_PROBE_COMMAND).not.toContain('$PSVersionTable');

    const base64Part = WINDOWS_OS_PROBE_COMMAND.split('-EncodedCommand ')[1] ?? '';
    const decoded = Buffer.from(base64Part, 'base64').toString('utf16le');
    expect(decoded).toBe('$PSVersionTable.PSVersion.Major');
    expect(decoded).toBe(WINDOWS_OS_PROBE_SCRIPT);
  });

  it('Windows 采集脚本的 [math]::Max/Min 调用不使用整数字面量 0 作为首参，避免 Int32 重载溢出', () => {
    expect(WINDOWS_READONLY_STATUS_SCRIPT).not.toContain('[math]::Max(0,');
    expect(WINDOWS_READONLY_STATUS_SCRIPT).not.toMatch(/\[math\]::(?:Max|Min)\(\s*0\s*,/i);
    expect(WINDOWS_READONLY_STATUS_SCRIPT).toContain(
      '$usedMem = [math]::Max([int64]0, [int64]($totalMem - $freeMem))',
    );
    expect(WINDOWS_READONLY_STATUS_SCRIPT).toContain(
      '$uptimeSeconds = [int64][math]::Max([double]0,',
    );
  });

  it('正确解析 Windows 输出为统一结构', () => {
    const data = parseWindowsDeviceOutput(`\uFEFF${SAMPLE_WINDOWS_STDOUT}`);
    expect(data.hostname).toBe('DEMO-WIN');
    expect(data.os).toBe('windows');
    expect(data.osVersion).toBe('Microsoft Windows 11 Pro 10.0.22631');
    expect(data.cpu).toEqual({
      model: 'Demo CPU 12-Core',
      cores: 12,
      loadPercent: 28.5,
    });
    expect(data.memory.usedPercent).toBe(50);
    expect(data.disks[0]).toMatchObject({
      mount: 'C:',
      label: '系统盘',
      usedPercent: 80,
    });
  });

  it('正确解析 macOS 输出（vm_stat、APFS df 去重及带空格挂载点、top 负载）', () => {
    const data = parseMacosDeviceOutput(SAMPLE_MACOS_STDOUT);
    expect(data.hostname).toBe('DEMO-MAC');
    expect(data.os).toBe('macos');
    expect(data.osVersion).toBe('macOS 15.1 (24B83)');
    expect(data.uptimeSeconds).toBe(3 * 86400);
    expect(data.cpu).toEqual({
      model: 'Apple M2 Pro (Demo)',
      cores: 10,
      loadPercent: 18.5,
    });
    // (320000 + 120000 + 80000) * 16384 = 8,519,680,000 bytes (~49.6%)
    expect(data.memory.totalBytes).toBe(17179869184);
    expect(data.memory.usedBytes).toBe((320000 + 120000 + 80000) * 16384);
    expect(data.memory.usedPercent).toBe(49.6);

    // /dev/disk3s1s1 (/) 与 /dev/disk3s5 (/System/Volumes/Data) 去重，仅保留 /System/Volumes/Data；保留外接卷 My Drive
    expect(data.disks).toHaveLength(2);
    expect(data.disks[0]).toMatchObject({
      mount: '/System/Volumes/Data',
      label: '系统盘',
      totalBytes: 482797652 * 1024,
      freeBytes: 200000000 * 1024,
    });
    expect(data.disks[1]).toMatchObject({
      mount: '/Volumes/My Drive',
      label: 'My Drive',
      usedPercent: 80,
    });
  });

  it('正确解析 Linux 输出（/proc/stat 采样、loadavg 回退、meminfo 与 df 排除虚拟卷）', () => {
    const data = parseLinuxDeviceOutput(SAMPLE_LINUX_STDOUT);
    expect(data.hostname).toBe('demo-linux');
    expect(data.os).toBe('linux');
    expect(data.osVersion).toBe('Debian GNU/Linux 12 (bookworm)');
    expect(data.uptimeSeconds).toBe(172800);
    // deltaTotal = 11000 - 10000 = 1000, deltaIdle = 9200 - 8500 = 700 -> 30%
    expect(data.cpu).toEqual({
      model: 'Demo Linux EPYC 8-Core',
      cores: 8,
      loadPercent: 30,
    });
    expect(data.memory.totalBytes).toBe(16384000 * 1024);
    expect(data.memory.usedBytes).toBe(8192000 * 1024);
    expect(data.memory.usedPercent).toBe(50);

    // 已排除 devtmpfs / tmpfs / overlay
    expect(data.disks).toHaveLength(2);
    expect(data.disks[0]).toMatchObject({
      mount: '/',
      label: '根分区',
      usedPercent: 40,
    });
    expect(data.disks[1]).toMatchObject({
      mount: '/mnt/media',
      usedPercent: 90,
    });

    // 无 CPU_STAT 时回退到 LOADAVG 且无 MemAvailable 时回退到 MemFree+Buffers+Cached
    const fallbackStdout = [
      'HOSTNAME=demo-fallback',
      'UPTIME=3600.0 0.0',
      'CPU_CORES=4',
      'LOADAVG=2.00 1.00 0.50 1/100 1',
      '===MEMINFO===',
      'MemTotal:       4000 kB',
      'MemFree:        1000 kB',
      'Buffers:         500 kB',
      'Cached:          500 kB',
      '===DF===',
      '/dev/sda1 100000 50000 50000 50% /',
      '===END===',
    ].join('\n');
    const fallback = parseLinuxDeviceOutput(fallbackStdout, Date.parse('2026-11-27T08:00:00.000Z'));
    expect(fallback.cpu.loadPercent).toBe(50);
    expect(fallback.memory.usedBytes).toBe(2000 * 1024);
    expect(fallback.memory.usedPercent).toBe(50);
  });
});

describe('多设备清单校验、保存备份、迁移与模拟模式', () => {
  let tmpDir: string;
  let devicesFilePath: string;
  let passwordHash: string;
  let database: DatabaseConnection;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homedash-devices-'));
    devicesFilePath = path.join(tmpDir, 'devices.json');
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
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

  it('未配置返回 UNCONFIGURED，旧版 WIN_SSH_* 自动迁移为只读虚拟设备，MOCK 返回模拟 Windows 和 macOS', async () => {
    const unconfiguredSvc = createDevicesService(makeConfig());
    const unconfiguredList = unconfiguredSvc.getDevices();
    expect(unconfiguredList.configured).toBe(false);
    expect(unconfiguredList.source).toBe('unconfigured');
    expect(unconfiguredList.errorCode).toBe('UNCONFIGURED');

    const legacyCfg = makeConfig({
      WIN_SSH_HOST: '192.0.2.20',
      WIN_SSH_PORT: '22',
      WIN_SSH_USER: 'demo',
      WIN_SSH_KEY_PATH: './secrets/demo-win-key',
    });
    const legacySvc = createDevicesService(legacyCfg);
    const legacyList = legacySvc.getDevices();
    expect(legacyList.configured).toBe(true);
    expect(legacyList.source).toBe('legacy-windows');
    expect(legacyList.readonly).toBe(true);
    expect(legacyList.readonlyReason).toBe(LEGACY_READONLY_REASON);
    expect(legacyList.devices).toHaveLength(1);
    expect(legacyList.devices[0]).toMatchObject({
      id: 'legacy-windows',
      name: 'Windows 设备',
      os: 'windows',
    });

    // 迁移模式禁止 PUT 保存
    const legacySave = legacySvc.saveDevices({ devices: [] });
    expect(legacySave.ok).toBe(false);
    if (!legacySave.ok) {
      expect(legacySave.status).toBe(403);
      expect(legacySave.error).toBe(LEGACY_READONLY_REASON);
    }

    // DEVICES_MOCK 与 WIN_MOCK 均返回模拟 Windows + 模拟 macOS
    for (const mockKey of ['DEVICES_MOCK', 'WIN_MOCK'] as const) {
      const mockSvc = createDevicesService(makeConfig({ [mockKey]: 'true' }));
      const mockStatuses = await mockSvc.getAllStatuses();
      expect(mockStatuses.configured).toBe(true);
      expect(mockStatuses.source).toBe('mock');
      expect(mockStatuses.devices).toHaveLength(2);
      expect(mockStatuses.devices.map((d) => d.os)).toEqual(['windows', 'macos']);
    }
  });

  it('PUT /api/devices 支持 zod 校验、原子写入与 .bak 备份，DEVICES_READONLY=true 返回 403，且不泄露私钥内容', async () => {
    fs.writeFileSync(
      devicesFilePath,
      JSON.stringify({
        devices: [
          {
            id: 'old-win',
            name: '旧设备',
            host: '192.0.2.10',
            port: 22,
            user: 'demo',
            keyPath: './secrets/demo_key',
            os: 'windows',
            enabled: true,
          },
        ],
      }),
      'utf-8',
    );

    const cfg = makeConfig({ DEVICES_FILE: devicesFilePath });
    const app = createApp(cfg, database.db, {
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });
    const cookie = await loginAndGetCookie(app);

    // 校验失败返回 400
    const invalidRes = await app.request('/api/devices', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        devices: [{ name: '', host: '192.0.2.20', port: 99999, user: 'demo', keyPath: 'k' }],
      }),
    });
    expect(invalidRes.status).toBe(400);

    // 合法保存：写前生成 .bak 备份
    const putRes = await app.request('/api/devices', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        devices: [
          {
            id: 'mac-1',
            name: '书房 Mac mini',
            host: 'demo-mac.local',
            user: 'demo',
            keyPath: './secrets/demo_mac_key',
          },
        ],
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as DeviceListResponse;
    expect(putBody.devices[0]).toMatchObject({
      id: 'mac-1',
      port: 22,
      os: 'auto',
      enabled: true,
      note: null,
    });
    expect(fs.existsSync(`${devicesFilePath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${devicesFilePath}.bak`, 'utf-8')).toContain('old-win');
    expect(fs.readFileSync(devicesFilePath, 'utf-8')).toContain('mac-1');

    // GET /api/devices 返回 keyPath 供界面编辑，但绝不读取或包含私钥内容
    const getRes = await app.request('/api/devices', {
      headers: { Cookie: cookie },
    });
    const getText = await getRes.text();
    expect(getText).toContain('./secrets/demo_mac_key');
    expect(getText).not.toContain(TEST_KEY_CONTENT);

    // DEVICES_READONLY=true 返回 403
    const roApp = createApp(
      makeConfig({ DEVICES_FILE: devicesFilePath, DEVICES_READONLY: 'true' }),
      database.db,
    );
    const roCookie = await loginAndGetCookie(roApp);
    const roRes = await roApp.request('/api/devices', {
      method: 'PUT',
      headers: { Cookie: roCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices: [] }),
    });
    expect(roRes.status).toBe(403);
  });
});

describe('多设备识别、并行采集、缓存复用与测试接口（mock 执行器）', () => {
  let tmpDir: string;
  let devicesFilePath: string;
  let passwordHash: string;
  let database: DatabaseConnection;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homedash-collect-'));
    devicesFilePath = path.join(tmpDir, 'devices.json');
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeDevicesFile(devices: unknown[]) {
    fs.writeFileSync(devicesFilePath, JSON.stringify({ devices }), 'utf-8');
  }

  function makeConfig(overrides: Record<string, string | undefined> = {}) {
    return parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      DEVICES_FILE: devicesFilePath,
      ...overrides,
    });
  }

  it('os=auto 按 uname -s 识别 macos / linux，回退 PowerShell 识别 windows，均失败报 OS_DETECT_FAILED，且结果缓存 10 分钟', async () => {
    writeDevicesFile([
      {
        id: 'd-mac',
        name: 'Mac',
        host: 'demo-mac.local',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k1',
        os: 'auto',
      },
      {
        id: 'd-linux',
        name: 'Linux',
        host: '192.0.2.30',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k2',
        os: 'auto',
      },
      {
        id: 'd-win',
        name: 'Win',
        host: '192.0.2.20',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k3',
        os: 'auto',
      },
      {
        id: 'd-bad',
        name: 'Bad',
        host: '192.0.2.40',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k4',
        os: 'auto',
      },
    ]);

    let currentTime = Date.parse('2026-11-27T08:00:00.000Z');
    const executor = vi.fn<SshCommandExecutor>(async (params) => {
      if (params.command === UNIX_OS_PROBE_COMMAND) {
        if (params.host === 'demo-mac.local') return { code: 0, stdout: 'Darwin\n', stderr: '' };
        if (params.host === '192.0.2.30') return { code: 0, stdout: 'Linux\n', stderr: '' };
        return { code: 1, stdout: '', stderr: 'uname not found' };
      }
      if (params.command === WINDOWS_OS_PROBE_COMMAND) {
        if (params.host === '192.0.2.20') return { code: 0, stdout: '5\n', stderr: '' };
        return { code: 1, stdout: '', stderr: 'not powershell' };
      }
      if (params.command === MACOS_READONLY_STATUS_COMMAND) {
        return { code: 0, stdout: SAMPLE_MACOS_STDOUT, stderr: '' };
      }
      if (params.command === LINUX_READONLY_STATUS_COMMAND) {
        return { code: 0, stdout: SAMPLE_LINUX_STDOUT, stderr: '' };
      }
      return { code: 0, stdout: SAMPLE_WINDOWS_STDOUT, stderr: '' };
    });

    const svc = createDevicesService(makeConfig({ DEVICE_CACHE_SECONDS: '30' }), {
      executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
      now: () => currentTime,
    });

    const first = await svc.getAllStatuses();
    expect(first.summary).toEqual({ total: 4, online: 3, offline: 1 });
    expect(first.devices.find((d) => d.id === 'd-mac')?.os).toBe('macos');
    expect(first.devices.find((d) => d.id === 'd-linux')?.os).toBe('linux');
    expect(first.devices.find((d) => d.id === 'd-win')?.os).toBe('windows');
    const bad = first.devices.find((d) => d.id === 'd-bad');
    expect(bad?.online).toBe(false);
    expect(bad?.errorCode).toBe('OS_DETECT_FAILED');

    // 1 分钟后状态缓存过期但 OS 识别 10 分钟缓存仍命中，再次刷新不会重新执行探测命令
    executor.mockClear();
    currentTime += 60_000;
    await svc.getDeviceStatus('d-mac', { refresh: true });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[0].command).toBe(MACOS_READONLY_STATUS_COMMAND);

    // 超过 10 分钟后 OS 识别缓存过期，重新触发探测
    executor.mockClear();
    currentTime += 10 * 60_000 + 1000;
    await svc.getDeviceStatus('d-mac', { refresh: true });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[0]?.[0].command).toBe(UNIX_OS_PROBE_COMMAND);
  });

  it('当 uname 返回空 stdout 且 stderr 包含 PowerShell 报错时仍继续 Windows 探测并成功识别', async () => {
    writeDevicesFile([
      {
        id: 'win-ps-exit1',
        name: 'Win PowerShell Exit 1',
        host: '192.0.2.51',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k1',
        os: 'auto',
      },
      {
        id: 'win-ps-exit0',
        name: 'Win PowerShell Exit 0',
        host: '192.0.2.52',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k2',
        os: 'auto',
      },
    ]);

    const psUnameError =
      "uname : The term 'uname' is not recognized as the name of a cmdlet, function, script file, or operable program.";
    const executor = vi.fn<SshCommandExecutor>(async (params) => {
      if (params.command === UNIX_OS_PROBE_COMMAND) {
        return {
          code: params.host === '192.0.2.52' ? 0 : 1,
          stdout: '',
          stderr: psUnameError,
        };
      }
      if (params.command === WINDOWS_OS_PROBE_COMMAND) {
        return { code: 0, stdout: '5\r\n', stderr: '' };
      }
      return { code: 0, stdout: SAMPLE_WINDOWS_STDOUT, stderr: '' };
    });

    const svc = createDevicesService(makeConfig({ DEVICE_CACHE_SECONDS: '30' }), {
      executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });

    const result = await svc.getAllStatuses();
    expect(result.summary).toEqual({ total: 2, online: 2, offline: 0 });
    expect(result.devices.map((d) => ({ id: d.id, os: d.os, online: d.online }))).toEqual([
      { id: 'win-ps-exit1', os: 'windows', online: true },
      { id: 'win-ps-exit0', os: 'windows', online: true },
    ]);
    expect(
      executor.mock.calls.filter(([call]) => call.command === WINDOWS_OS_PROBE_COMMAND),
    ).toHaveLength(2);
  });

  it('多台设备并行采集时一台失败不影响其它，每台独立缓存与并发复用', async () => {
    writeDevicesFile([
      {
        id: 'dev-ok',
        name: 'Mac 正常',
        host: 'demo-mac.local',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k1',
        os: 'macos',
      },
      {
        id: 'dev-fail',
        name: 'Win 超时',
        host: '192.0.2.21',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k2',
        os: 'windows',
      },
    ]);

    let resolveMac!: (res: { code: number; stdout: string; stderr: string }) => void;
    let macCalls = 0;
    let failCalls = 0;

    const executor = vi.fn<SshCommandExecutor>((params) => {
      if (params.host === 'demo-mac.local') {
        macCalls += 1;
        return new Promise((resolve) => {
          resolveMac = resolve;
        });
      }
      failCalls += 1;
      return Promise.reject(new SshCollectorError('TIMEOUT', 'timed out'));
    });

    let currentTime = Date.parse('2026-11-27T08:00:00.000Z');
    const svc = createDevicesService(makeConfig({ DEVICE_CACHE_SECONDS: '30' }), {
      executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
      now: () => currentTime,
    });

    // 并发请求复用进行中采集
    const p1 = svc.getAllStatuses();
    const p2 = svc.getAllStatuses();
    await vi.waitFor(() => expect(macCalls).toBe(1));
    resolveMac({ code: 0, stdout: SAMPLE_MACOS_STDOUT, stderr: '' });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(macCalls).toBe(1);
    expect(failCalls).toBe(1);
    expect(r1.summary).toEqual({ total: 2, online: 1, offline: 1 });
    expect(r1.devices[0]?.online).toBe(true);
    expect(r1.devices[1]?.online).toBe(false);
    expect(r1.devices[1]?.errorCode).toBe('TIMEOUT');
    expect(r2.summary.online).toBe(1);

    // 5 秒后：失败设备和成功设备均命中独立缓存
    currentTime += 5_000;
    const cachedAll = await svc.getAllStatuses();
    expect(cachedAll.devices.every((d) => d.cached)).toBe(true);
    expect(macCalls).toBe(1);
    expect(failCalls).toBe(1);

    // 11 秒后：失败冷却（10s）已过期会重采失败设备，而成功设备（>=60s）仍命中缓存
    currentTime += 6_000;
    const afterFailureCooldown = await svc.getAllStatuses();
    expect(afterFailureCooldown.devices[0]?.cached).toBe(true);
    expect(afterFailureCooldown.devices[1]?.cached).toBe(false);
    expect(macCalls).toBe(1);
    expect(failCalls).toBe(2);
  });

  it('DEVICE_CACHE_SECONDS=0/30 与 resolveEffectiveCacheSeconds 均下限钳制 >= 60 秒，支持 refresh=1 强制刷新与单设备并发去重', async () => {
    writeDevicesFile([
      {
        id: 'mac-1',
        name: 'Mac mini',
        host: 'demo-mac.local',
        port: 22,
        user: 'demo',
        keyPath: './secrets/k1',
        os: 'macos',
      },
    ]);

    // 手工构造低于 60 的配置，resolveEffectiveCacheSeconds 仍应钳制为 60
    const lowDevicesConfig = makeConfig({ DEVICE_CACHE_SECONDS: '120' });
    const manualLowConfig = {
      ...lowDevicesConfig,
      devices: {
        ...lowDevicesConfig.devices!,
        DEVICE_CACHE_SECONDS: 15,
      },
    };
    expect(resolveEffectiveCacheSeconds(manualLowConfig)).toBe(60);
    expect(resolveEffectiveCacheSeconds(makeConfig())).toBe(60);

    let currentTime = Date.parse('2026-11-27T08:00:00.000Z');
    const executor = vi.fn<SshCommandExecutor>(async () => ({
      code: 0,
      stdout: SAMPLE_MACOS_STDOUT,
      stderr: '',
    }));

    const app = createApp(makeConfig({ DEVICE_CACHE_SECONDS: '0' }), database.db, {
      now: () => currentTime,
      sshExecutor: executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });
    const cookie = await loginAndGetCookie(app);

    // 并发请求同一设备仅触发 1 次 SSH
    let releaseFirst!: (res: { code: number; stdout: string; stderr: string }) => void;
    executor.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const req1 = app.request('/api/devices/status', { headers: { Cookie: cookie } });
    const req2 = app.request('/api/devices/mac-1/status', { headers: { Cookie: cookie } });
    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1));
    releaseFirst({ code: 0, stdout: SAMPLE_MACOS_STDOUT, stderr: '' });

    const [res1, res2] = await Promise.all([req1, req2]);
    const body1 = (await res1.json()) as DevicesStatusResponse;
    const body2 = (await res2.json()) as DeviceStatusItem;
    expect(body1.devices[0]?.online).toBe(true);
    expect(body2.online).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);

    // 59 秒后仍命中 60 秒下限缓存（cached: true）
    currentTime += 59_000;
    const cachedRes = await app.request('/api/devices/status', { headers: { Cookie: cookie } });
    const cachedBody = (await cachedRes.json()) as DevicesStatusResponse;
    expect(cachedBody.devices[0]?.cached).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);

    // 超过 60 秒后缓存过期，自动重采（cached: false）
    currentTime += 2_000;
    const expiredRes = await app.request('/api/devices/status', { headers: { Cookie: cookie } });
    const expiredBody = (await expiredRes.json()) as DevicesStatusResponse;
    expect(expiredBody.devices[0]?.cached).toBe(false);
    expect(executor).toHaveBeenCalledTimes(2);

    // ?refresh=1 强制跳过缓存
    const refreshRes = await app.request('/api/devices/status?refresh=1', {
      headers: { Cookie: cookie },
    });
    const refreshBody = (await refreshRes.json()) as DevicesStatusResponse;
    expect(refreshBody.devices[0]?.cached).toBe(false);
    expect(executor).toHaveBeenCalledTimes(3);
  });

  it('HTTP 路由需登录，test 接口不保存不缓存，状态与测试接口绝不泄露私钥或 keyPath', async () => {
    writeDevicesFile([
      {
        id: 'mac-1',
        name: 'Mac mini',
        host: 'demo-mac.local',
        port: 22,
        user: 'demo',
        keyPath: './secrets/ultra_secret_key_path_name',
        os: 'macos',
      },
    ]);

    const executor = vi.fn<SshCommandExecutor>(async (params) => {
      if (params.command === UNIX_OS_PROBE_COMMAND) {
        return { code: 0, stdout: 'Linux\n', stderr: '' };
      }
      return { code: 0, stdout: SAMPLE_MACOS_STDOUT, stderr: '' };
    });

    const app = createApp(makeConfig(), database.db, {
      sshExecutor: executor,
      readPrivateKey: async () => TEST_KEY_CONTENT,
    });

    expect((await app.request('/api/devices')).status).toBe(401);
    expect((await app.request('/api/devices/status')).status).toBe(401);
    expect((await app.request('/api/devices/mac-1/status')).status).toBe(401);
    expect(
      (
        await app.request('/api/devices/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(401);

    const cookie = await loginAndGetCookie(app);

    // 测试连接接口：不保存文件，不写入缓存
    const testRes = await app.request('/api/devices/test', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '192.0.2.88',
        port: 22,
        user: 'demo',
        keyPath: './secrets/test_only_key_path',
        os: 'auto',
      }),
    });
    expect(testRes.status).toBe(200);
    const testText = await testRes.text();
    expect(testText).not.toContain(TEST_KEY_CONTENT);
    expect(testText).not.toContain('test_only_key_path');
    const testJson = JSON.parse(testText) as DeviceTestResponse;
    expect(testJson.ok).toBe(true);
    expect(testJson.os).toBe('linux');

    // 设备清单未被 test 修改
    const savedRaw = fs.readFileSync(devicesFilePath, 'utf-8');
    expect(savedRaw).not.toContain('192.0.2.88');

    // GET /api/devices/status 与 GET /api/devices/:id/status 不含私钥与 keyPath
    const statusRes = await app.request('/api/devices/status', {
      headers: { Cookie: cookie },
    });
    expect(statusRes.status).toBe(200);
    const statusText = await statusRes.text();
    expect(statusText).not.toContain(TEST_KEY_CONTENT);
    expect(statusText).not.toContain('ultra_secret_key_path_name');
    const statusJson = JSON.parse(statusText) as DevicesStatusResponse;
    expect(statusJson.devices[0]?.online).toBe(true);

    const singleRes = await app.request('/api/devices/mac-1/status', {
      headers: { Cookie: cookie },
    });
    expect(singleRes.status).toBe(200);
    const singleJson = (await singleRes.json()) as DeviceStatusItem;
    expect(singleJson.cached).toBe(true);

    const missingRes = await app.request('/api/devices/not-found/status', {
      headers: { Cookie: cookie },
    });
    expect(missingRes.status).toBe(404);
  });
});
