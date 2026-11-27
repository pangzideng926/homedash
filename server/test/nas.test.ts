import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  createMockNasStatus,
  NAS_READONLY_STATUS_COMMAND,
  NAS_READONLY_STATUS_SCRIPT,
  parseMdstatOutput,
  parseNasDfOutput,
  parseNasDockerOutput,
  parseNasSmartOutput,
  parseNasStatusOutput,
  parseNasTemperatures,
  type NasStatusResponse,
} from '../src/nas/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  return setCookieHeader?.split(';')[0] ?? '';
}

const SAMPLE_NAS_STDOUT = [
  'HOSTNAME=demo-nas',
  'NOW_EPOCH=1764201600',
  'UPTIME=864000.50 123456.00',
  'LOADAVG=0.45 0.38 0.30 1/320 4120',
  'CPU_CORES=4',
  'CPU_MODEL=Demo NAS Processor N100',
  'CPU_STAT_1=cpu  1000 100 500 8000 200 0 100 0 0 0',
  'CPU_STAT_2=cpu  1200 100 600 8600 200 0 100 0 0 0',
  '===OS_RELEASE===',
  'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"',
  '===MEMINFO===',
  'MemTotal:       16384000 kB',
  'MemAvailable:    8192000 kB',
  '===THERMAL===',
  'TZ|acpitz|38000',
  'TZ|x86_pkg_temp|51000',
  'HW|coretemp|Package id 0|54000',
  'HW|coretemp|Core 0|48000',
  'HW|nvme|Composite|43500',
  'HW|spd5118|temp1|40000',
  '===SMART===',
  'SMART_DISK_START|/dev/sda',
  'SMART_RC|2',
  'Smartctl open device: /dev/sda failed: Permission denied',
  'SMART_DISK_END',
  '===MDSTAT===',
  'Personalities : [raid1]',
  'md0 : active raid1 nvme0n1p1[0] nvme1n1p1[1]',
  '      104857600 blocks super 1.2 [2/2] [UU]',
  '',
  'md1 : active raid1 sda1[0] sdb1[1](F)',
  '      7813894144 blocks super 1.2 [2/1] [U_]',
  'unused devices: <none>',
  '===DF===',
  'Filesystem     Type      1024-blocks      Used  Available Capacity Mounted on',
  'udev           devtmpfs      8192000         0    8192000       0% /dev',
  'tmpfs          tmpfs         1638400      1200    1637200       1% /run',
  '/dev/nvme0n1p2 ext4        100000000  25000000   70000000      26% /',
  '/dev/sda2      vfat           524288     10240     514048       2% /boot/efi',
  '/dev/loop0     squashfs       102400    102400          0     100% /snap/core',
  'overlay        overlay     100000000  25000000   70000000      26% /var/lib/docker/overlay2',
  '/dev/mmcblk0p3 ext4          8000000   2000000    6000000      25% /ugreen',
  '/dev/mmcblk0p4 ext4          8000000   2000000    6000000      25% /mnt/factory',
  '/dev/md0       btrfs      2000000000 1000000000 1000000000     50% /volume1',
  '/dev/md1       ext4       8000000000 7200000000  800000000     90% /volume2',
  '===DOCKER===',
  'permission denied while trying to connect to the Docker daemon socket',
  'DOCKER_EXIT=1',
  '===END===',
].join('\n');

describe('NAS 只读采集脚本安全性与解析', () => {
  it('脚本绝对只读且不包含 sudo、重启、写文件或 docker 修改命令', () => {
    expect(NAS_READONLY_STATUS_SCRIPT).not.toContain("'");
    expect(NAS_READONLY_STATUS_COMMAND).toContain('/bin/sh -c');
    expect(NAS_READONLY_STATUS_SCRIPT).not.toMatch(/\bsudo\b/i);
    expect(NAS_READONLY_STATUS_SCRIPT).not.toMatch(
      /\b(reboot|shutdown|poweroff|mkfs|rm\s|dd\s)\b/i,
    );
    expect(NAS_READONLY_STATUS_SCRIPT).not.toMatch(
      /\bdocker\s+(start|stop|restart|rm|kill|exec)\b/i,
    );
    expect(NAS_READONLY_STATUS_SCRIPT).not.toMatch(/[^2]>\s*(?!\/dev\/null\b)[^&]/);
  });

  it('正确解析系统、温度分组、mdstat 正常/降级、df 分区过滤与 Docker 权限不足', () => {
    const parsed = parseNasStatusOutput(SAMPLE_NAS_STDOUT, 1764201600 * 1000);

    expect(parsed.hostname).toBe('demo-nas');
    expect(parsed.osVersion).toBe('Debian GNU/Linux 12 (bookworm)');
    expect(parsed.uptimeSeconds).toBe(864000);
    expect(parsed.loadAvg).toEqual([0.45, 0.38, 0.3]);
    // deltaTotal = 900, deltaIdle = 600 => 33.3%
    expect(parsed.cpu.loadPercent).toBe(33.3);
    expect(parsed.memory.usedPercent).toBe(50);

    // 温度分组与各组最大值
    const byCat = Object.fromEntries(parsed.temperatures.map((g) => [g.category, g.maxTempC]));
    expect(byCat.cpu).toBe(54);
    expect(byCat.nvme).toBe(43.5);
    expect(byCat.memory).toBe(40);
    expect(byCat.motherboard).toBe(38);
    expect(parsed.maxTemperatureC).toBe(54);

    // SMART 无权限跳过
    expect(parsed.smart).toEqual({
      available: false,
      reason: '需要 root 权限，已跳过',
      disks: [],
    });

    // RAID 正常与降级
    expect(parsed.raids).toHaveLength(2);
    expect(parsed.raids[0]).toMatchObject({
      name: 'md0',
      level: 'raid1',
      stateFlags: '[UU]',
      healthy: true,
      statusLabel: '正常',
    });
    expect(parsed.raids[1]).toMatchObject({
      name: 'md1',
      level: 'raid1',
      stateFlags: '[U_]',
      healthy: false,
      statusLabel: '降级',
    });

    // df 过滤系统分区与虚拟文件系统，保留 /volume* 在前
    const mounts = parsed.volumes.map((v) => v.mount);
    expect(mounts).toEqual(['/volume1', '/volume2', '/']);
    expect(parsed.volumes[0]?.isVolume).toBe(true);
    expect(parsed.volumes[1]?.usedPercent).toBe(90);

    // Docker 权限不足中文提示
    expect(parsed.docker).toEqual({
      available: false,
      reason: '当前账号无权访问 Docker（需要加入 docker 组），已跳过',
      containers: [],
    });
  });

  it('支持解析可用 Docker 容器列表及可用 SMART 硬盘温度', () => {
    const dockerInfo = parseNasDockerOutput([
      '{"ID":"abc1","Names":"qbittorrent","Image":"linuxserver/qbittorrent:latest","State":"running","Status":"Up 3 days","RunningFor":"3 days ago","Ports":"0.0.0.0:8080->8080/tcp"}',
      'DOCKER_EXIT=0',
    ]);
    expect(dockerInfo.available).toBe(true);
    expect(dockerInfo.containers).toHaveLength(1);
    expect(dockerInfo.containers[0]).toMatchObject({
      name: 'qbittorrent',
      image: 'linuxserver/qbittorrent:latest',
      state: 'running',
      status: 'Up 3 days',
      ports: '0.0.0.0:8080->8080/tcp',
    });

    const smartOk = parseNasSmartOutput([
      'SMART_DISK_START|/dev/sda',
      'SMART_RC|0',
      JSON.stringify({ model_name: 'Demo IronWolf 8TB', temperature: { current: 36 } }),
      'SMART_DISK_END',
    ]);
    expect(smartOk.available).toBe(true);
    expect(smartOk.disks).toEqual([{ device: '/dev/sda', model: 'Demo IronWolf 8TB', tempC: 36 }]);

    const temps = parseNasTemperatures(['TZ|acpitz|41000', 'HW|coretemp|Core 0|62000']);
    expect(temps).toHaveLength(2);
    expect(
      parseMdstatOutput(['md2 : active raid5 sda1[0] sdb1[1] sdc1[2]', ' [3/3] [UUU]']),
    ).toHaveLength(1);
    expect(parseNasDfOutput(['/dev/sda1 ext4 1000 500 500 50% /rootfs'])).toEqual([]);
  });
});

describe('NAS 接口与缓存（GET /api/nas/status）', () => {
  let database: DatabaseConnection;
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(TEST_PASSWORD);
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
  });

  it('NAS_MOCK=true 返回模拟 Debian 12 NAS 状态，且提供可切换 Docker 可用性的测试数据', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      NAS_MOCK: 'true',
    });

    const app = createApp(config, database.db);
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const cookie = extractCookiePair(loginRes.headers.get('set-cookie'));

    const res = await app.request('/api/nas/status', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NasStatusResponse;
    expect(body.configured).toBe(true);
    expect(body.mock).toBe(true);
    expect(body.online).toBe(true);
    expect(body.data?.osVersion).toContain('Debian');
    expect(body.data?.volumes).toHaveLength(2);
    expect(body.data?.raids).toHaveLength(2);
    expect(body.data?.docker.available).toBe(false);

    const mockWithDocker = createMockNasStatus(Date.now(), { dockerAvailable: true });
    expect(mockWithDocker.docker.available).toBe(true);
    expect(mockWithDocker.docker.containers.length).toBeGreaterThan(0);
  });

  it('真实 SSH 执行器采集支持缓存与 ?refresh=1 强制刷新', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      NAS_SSH_HOST: '192.0.2.10',
      NAS_SSH_PORT: '22',
      NAS_SSH_USER: 'demo',
      NAS_SSH_KEY_PATH: './secrets/test-nas-key',
      NAS_CACHE_SECONDS: '30',
    });

    let nowMs = new Date('2026-11-27T08:00:00.000Z').getTime();
    const sshExecutor = vi.fn().mockResolvedValue({
      code: 0,
      stdout: SAMPLE_NAS_STDOUT,
      stderr: '',
    });
    const readPrivateKey = vi.fn().mockResolvedValue('test-private-key-content');

    const app = createApp(config, database.db, {
      now: () => nowMs,
      sshExecutor,
      readPrivateKey,
    });

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const cookie = extractCookiePair(loginRes.headers.get('set-cookie'));

    const res1 = await app.request('/api/nas/status', { headers: { Cookie: cookie } });
    const body1 = (await res1.json()) as NasStatusResponse;
    expect(body1.online).toBe(true);
    expect(body1.cached).toBe(false);
    expect(sshExecutor).toHaveBeenCalledTimes(1);

    // 10 秒内命中缓存
    nowMs += 10_000;
    const res2 = await app.request('/api/nas/status', { headers: { Cookie: cookie } });
    const body2 = (await res2.json()) as NasStatusResponse;
    expect(body2.cached).toBe(true);
    expect(sshExecutor).toHaveBeenCalledTimes(1);

    // ?refresh=1 强制刷新
    const res3 = await app.request('/api/nas/status?refresh=1', { headers: { Cookie: cookie } });
    const body3 = (await res3.json()) as NasStatusResponse;
    expect(body3.cached).toBe(false);
    expect(sshExecutor).toHaveBeenCalledTimes(2);
  });
});
