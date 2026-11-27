import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { parseConfig } from '../src/config/index.js';
import { createDatabase, type DatabaseConnection } from '../src/db/index.js';
import {
  DOCKER_LIST_NAMES_COMMAND,
  parseNasDockerOutput,
  type DockerAuditResponse,
  type DockerLogsResponse,
  type NasStatusResponse,
} from '../src/nas/index.js';

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('缺少 Set-Cookie');
  return setCookieHeader.split(';')[0] ?? '';
}

const SAMPLE_NAS_WITH_DOCKER_STATS = [
  'HOSTNAME=demo-nas',
  'NOW_EPOCH=1764201600',
  'UPTIME=864000.50 123456.00',
  'LOADAVG=0.45 0.38 0.30 1/320 4120',
  'CPU_CORES=4',
  'CPU_MODEL=Demo NAS Processor',
  'CPU_STAT_1=cpu  1000 100 500 8000 200 0 100 0 0 0',
  'CPU_STAT_2=cpu  1200 100 600 8600 200 0 100 0 0 0',
  '===OS_RELEASE===',
  'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"',
  '===MEMINFO===',
  'MemTotal:       16384000 kB',
  'MemAvailable:    8192000 kB',
  '===THERMAL===',
  '===SMART===',
  'SMART_NO_DISKS',
  '===MDSTAT===',
  '===DF===',
  '/dev/md0       btrfs      2000000000 1000000000 1000000000     50% /volume1',
  '===DOCKER===',
  '{"ID":"c1","Names":"homedash","Image":"homedash:latest","State":"running","Status":"Up 5 days","RunningFor":"5 days ago","Ports":"0.0.0.0:3000->3000/tcp"}',
  '{"ID":"c2","Names":"qbittorrent","Image":"linuxserver/qbittorrent:latest","State":"running","Status":"Up 2 days","RunningFor":"2 days ago","Ports":"0.0.0.0:8080->8080/tcp"}',
  'DOCKER_EXIT=0',
  '===DOCKER_STATS===',
  '{"Name":"homedash","CPUPerc":"0.35%","MemUsage":"64MiB / 16GiB","MemPerc":"0.39%"}',
  '{"Name":"/qbittorrent","CPUPerc":"3.80%","MemUsage":"420MiB / 16GiB","MemPerc":"2.56%"}',
  '===END===',
].join('\n');

describe('Docker stats 合并解析与受限操作/审计日志', () => {
  let tempDir: string;
  let auditFile: string;
  let integrationsFile: string;
  let database: DatabaseConnection;
  let passwordHash: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homedash-docker-'));
    auditFile = path.join(tempDir, 'docker-audit.log');
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

  it('parseNasDockerOutput 按容器名合并 docker stats 并忽略无效 stats 输出', () => {
    const dockerInfo = parseNasDockerOutput(
      [
        '{"ID":"c1","Names":"qbittorrent","Image":"qb:latest","State":"running","Status":"Up 1d","RunningFor":"1d","Ports":""}',
        'DOCKER_EXIT=0',
      ],
      [
        '{"Name":"/qbittorrent","CPUPerc":"5.21%","MemUsage":"256MiB / 16GiB","MemPerc":"1.56%"}',
        'timeout error line',
      ],
    );

    expect(dockerInfo.available).toBe(true);
    expect(dockerInfo.containers[0]).toMatchObject({
      name: 'qbittorrent',
      cpuPercent: '5.21%',
      memUsage: '256MiB / 16GiB',
      memPercent: '1.56%',
    });
  });

  it('拒绝非法容器名注入、未在 ps 列表容器 404、开关关闭 403、受保护容器 403 与 tail 越界 400', async () => {
    const sshExecutor = vi.fn().mockImplementation(async (params: { command: string }) => {
      if (params.command === DOCKER_LIST_NAMES_COMMAND) {
        return { code: 0, stdout: 'homedash\nqbittorrent\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    // 1. DOCKER_ACTIONS_ENABLED 默认 false -> 403
    const disabledConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      NAS_SSH_HOST: '192.0.2.10',
      NAS_SSH_PORT: '22',
      NAS_SSH_USER: 'demo',
      NAS_SSH_KEY_PATH: './secrets/test-nas-key',
      DOCKER_AUDIT_FILE: auditFile,
    });
    const disabledApp = createApp(disabledConfig, database.db, {
      sshExecutor,
      readPrivateKey: vi.fn().mockResolvedValue('fake-key'),
    });
    const cookie1 = await loginCookie(disabledApp);

    const disabledRes = await disabledApp.request('/api/nas/docker/qbittorrent/restart', {
      method: 'POST',
      headers: { Cookie: cookie1 },
    });
    expect(disabledRes.status).toBe(403);
    expect(((await disabledRes.json()) as { error: string }).error).toContain('Docker 操作未开启');

    // 2. 开启操作后测试名称正则、受保护容器、404 与 tail 越界
    fs.writeFileSync(
      integrationsFile,
      JSON.stringify({ docker: { protectedContainers: ['custom-db'] } }),
    );
    const enabledConfig = parseConfig({
      NODE_ENV: 'test',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: ':memory:',
      INTEGRATIONS_FILE: integrationsFile,
      NAS_SSH_HOST: '192.0.2.10',
      NAS_SSH_PORT: '22',
      NAS_SSH_USER: 'demo',
      NAS_SSH_KEY_PATH: './secrets/test-nas-key',
      DOCKER_ACTIONS_ENABLED: 'true',
      DOCKER_AUDIT_FILE: auditFile,
    });
    const enabledApp = createApp(enabledConfig, database.db, {
      sshExecutor,
      readPrivateKey: vi.fn().mockResolvedValue('fake-key'),
    });
    const cookie2 = await loginCookie(enabledApp);

    const maliciousNames = [
      'a;rm -rf',
      '$(whoami)',
      '--help',
      'has space',
      "a'b",
      'a"b',
      '-leading-dash',
    ];
    for (const badName of maliciousNames) {
      const badRes = await enabledApp.request(
        `/api/nas/docker/${encodeURIComponent(badName)}/start`,
        {
          method: 'POST',
          headers: { Cookie: cookie2 },
        },
      );
      expect(badRes.status).toBe(400);
    }

    // 不在实时 docker ps -a 列表中的容器 -> 404
    const missingRes = await enabledApp.request('/api/nas/docker/unknown-container/start', {
      method: 'POST',
      headers: { Cookie: cookie2 },
    });
    expect(missingRes.status).toBe(404);

    // 受保护容器 stop / restart -> 403，但 start 允许
    for (const protectedName of ['homedash', 'custom-db']) {
      for (const act of ['stop', 'restart']) {
        const protRes = await enabledApp.request(`/api/nas/docker/${protectedName}/${act}`, {
          method: 'POST',
          headers: { Cookie: cookie2 },
        });
        expect(protRes.status).toBe(403);
        expect(((await protRes.json()) as { error: string }).error).toContain(
          '受保护容器不允许停止或重启',
        );
      }
    }

    const startProtectedRes = await enabledApp.request('/api/nas/docker/homedash/start', {
      method: 'POST',
      headers: { Cookie: cookie2 },
    });
    expect(startProtectedRes.status).toBe(200);

    // tail 越界 -> 400
    for (const badTail of ['0', '-1', '1001', 'abc', '12.5']) {
      const tailRes = await enabledApp.request(
        `/api/nas/docker/qbittorrent/logs?tail=${encodeURIComponent(badTail)}`,
        { headers: { Cookie: cookie2 } },
      );
      expect(tailRes.status).toBe(400);
    }

    // 确认已记录所有拒绝与成功审计日志
    const auditRes = await enabledApp.request('/api/nas/docker/audit?limit=50', {
      headers: { Cookie: cookie2 },
    });
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as DockerAuditResponse;
    expect(auditBody.entries.some((e) => e.result === 'rejected')).toBe(true);
    expect(
      auditBody.entries.some((e) => e.result === 'success' && e.container === 'homedash'),
    ).toBe(true);
  });

  it('命令模板精确断言、日志接口（开关关闭也可用）与操作后清除 NAS 状态缓存', async () => {
    const executedCommands: string[] = [];
    const sshExecutor = vi.fn().mockImplementation(async (params: { command: string }) => {
      executedCommands.push(params.command);
      if (params.command === DOCKER_LIST_NAMES_COMMAND) {
        return { code: 0, stdout: 'homedash\nqbittorrent\n', stderr: '' };
      }
      if (params.command.startsWith('docker logs ')) {
        return { code: 0, stdout: '2026-11-27T08:00:00Z line1\n', stderr: '' };
      }
      if (params.command.includes('/bin/sh -c')) {
        return { code: 0, stdout: SAMPLE_NAS_WITH_DOCKER_STATS, stderr: '' };
      }
      return { code: 0, stdout: 'qbittorrent\n', stderr: '' };
    });

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
      NAS_CACHE_SECONDS: '60',
      DOCKER_ACTIONS_ENABLED: 'true',
      DOCKER_AUDIT_FILE: auditFile,
    });

    const app = createApp(config, database.db, {
      sshExecutor,
      readPrivateKey: vi.fn().mockResolvedValue('fake-key'),
    });
    const cookie = await loginCookie(app);

    // 1. 首次查询 NAS 状态（写入缓存并验证 stats + protected 标记）
    const nasRes1 = await app.request('/api/nas/status', { headers: { Cookie: cookie } });
    const nasBody1 = (await nasRes1.json()) as NasStatusResponse;
    expect(nasBody1.cached).toBe(false);
    expect(nasBody1.data?.docker.actionsEnabled).toBe(true);
    expect(nasBody1.data?.docker.containers[0]).toMatchObject({
      name: 'homedash',
      protected: true,
      cpuPercent: '0.35%',
    });
    expect(nasBody1.data?.docker.containers[1]).toMatchObject({
      name: 'qbittorrent',
      protected: false,
      cpuPercent: '3.80%',
      memUsage: '420MiB / 16GiB',
      memPercent: '2.56%',
    });

    // 2. 命中缓存
    const nasRes2 = await app.request('/api/nas/status', { headers: { Cookie: cookie } });
    expect(((await nasRes2.json()) as NasStatusResponse).cached).toBe(true);

    // 3. 执行 stop / restart / start 并断言精确命令模板
    await app.request('/api/nas/docker/qbittorrent/stop', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    await app.request('/api/nas/docker/qbittorrent/restart', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    await app.request('/api/nas/docker/qbittorrent/start', {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(executedCommands).toContain("docker stop -- 'qbittorrent'");
    expect(executedCommands).toContain("docker restart -- 'qbittorrent'");
    expect(executedCommands).toContain("docker start -- 'qbittorrent'");

    // 4. 操作后缓存已清除，再次请求 /api/nas/status 应重新采集（cached: false）
    const nasRes3 = await app.request('/api/nas/status', { headers: { Cookie: cookie } });
    expect(((await nasRes3.json()) as NasStatusResponse).cached).toBe(false);

    // 5. 获取容器日志并断言精确命令模板
    const logsRes = await app.request('/api/nas/docker/qbittorrent/logs?tail=100', {
      headers: { Cookie: cookie },
    });
    expect(logsRes.status).toBe(200);
    const logsBody = (await logsRes.json()) as DockerLogsResponse;
    expect(logsBody.tail).toBe(100);
    expect(logsBody.logs).toContain('line1');
    expect(executedCommands).toContain("docker logs --tail 100 --timestamps -- 'qbittorrent'");

    // 6. 审计日志落盘为 JSON Lines
    const auditRaw = fs.readFileSync(auditFile, 'utf-8').trim().split('\n');
    expect(auditRaw).toHaveLength(3);
    expect(JSON.parse(auditRaw[0]!) as Record<string, unknown>).toMatchObject({
      username: TEST_USERNAME,
      container: 'qbittorrent',
      action: 'stop',
      result: 'success',
    });
  });
});
