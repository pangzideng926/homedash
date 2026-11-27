import fs from 'node:fs';
import type { AppConfig, SafeLogger } from '../config/index.js';
import { UNIX_OS_PROBE_COMMAND } from '../devices/commands.js';
import { DeviceStatusClassifiedError } from '../devices/parsers.js';
import { classifyDeviceError } from '../devices/service.js';
import { executeSshCommand, type SshCommandExecutor } from '../devices/ssh-executor.js';
import { resolveRepoRelativePath } from '../devices/store.js';
import type {
  IntegrationsStore,
  IntegrationTestResponse,
  NasTestOverride,
} from '../integrations/index.js';
import { NAS_READONLY_STATUS_COMMAND } from './command.js';
import { parseNasStatusOutput } from './parser.js';
import type { NasErrorCode, NasStatusData, NasStatusResponse } from './types.js';

const FAILURE_CACHE_MS = 10_000;
const DEFAULT_SSH_TIMEOUT_MS = 8000;

export interface CreateNasServiceOptions {
  executor?: SshCommandExecutor;
  readPrivateKey?: (keyPath: string) => Promise<string | Buffer>;
  now?: () => number;
  logger?: SafeLogger;
  timeoutMs?: number;
}

export interface NasService {
  getStatus: (options?: { refresh?: boolean }) => Promise<NasStatusResponse>;
  testConnection: (override?: NasTestOverride) => Promise<IntegrationTestResponse>;
  invalidateCache: () => void;
}

async function defaultReadPrivateKey(keyPath: string): Promise<string> {
  const resolved = resolveRepoRelativePath(keyPath);
  return fs.promises.readFile(resolved, 'utf-8');
}

/**
 * 生成模拟的 Debian 12 NAS 状态数据（两个卷、两个 RAID1、温度分组，支持切换 Docker 可用性用于测试）。
 */
export function createMockNasStatus(
  nowMs: number = Date.now(),
  options?: { dockerAvailable?: boolean },
): NasStatusData {
  const gib = 1024 * 1024 * 1024;
  const tib = 1024 * gib;
  const uptimeSeconds = 18 * 86400 + 6 * 3600 + 42 * 60;
  const dockerAvailable = options?.dockerAvailable ?? false;

  return {
    hostname: 'demo-nas',
    osVersion: 'Debian GNU/Linux 12 (bookworm)',
    uptimeSeconds,
    bootTime: new Date(nowMs - uptimeSeconds * 1000).toISOString(),
    loadAvg: [0.42, 0.51, 0.48],
    cpu: {
      model: 'Demo NAS Processor N100',
      cores: 4,
      loadPercent: 18.6,
    },
    memory: {
      totalBytes: 16 * gib,
      usedBytes: 9.2 * gib,
      availableBytes: 6.8 * gib,
      usedPercent: 57.5,
    },
    temperatures: [
      {
        category: 'cpu',
        label: 'CPU',
        maxTempC: 49.0,
        sensors: [
          { name: 'coretemp (Package id 0)', tempC: 49.0 },
          { name: 'coretemp (Core 0)', tempC: 46.0 },
        ],
      },
      {
        category: 'nvme',
        label: 'NVMe',
        maxTempC: 42.5,
        sensors: [{ name: 'nvme (Composite)', tempC: 42.5 }],
      },
      {
        category: 'memory',
        label: '内存',
        maxTempC: 39.0,
        sensors: [{ name: 'spd5118', tempC: 39.0 }],
      },
      {
        category: 'motherboard',
        label: '主板',
        maxTempC: 37.0,
        sensors: [{ name: 'acpitz', tempC: 37.0 }],
      },
    ],
    maxTemperatureC: 49.0,
    smart: {
      available: false,
      reason: '需要 root 权限，已跳过',
      disks: [],
    },
    raids: [
      {
        name: 'md0',
        status: 'active',
        level: 'raid1',
        members: ['nvme0n1p1[0]', 'nvme1n1p1[1]'],
        stateFlags: '[UU]',
        activeDevices: 2,
        totalDevices: 2,
        healthy: true,
        statusLabel: '正常',
      },
      {
        name: 'md1',
        status: 'active',
        level: 'raid1',
        members: ['sda1[0]', 'sdb1[1]'],
        stateFlags: '[UU]',
        activeDevices: 2,
        totalDevices: 2,
        healthy: true,
        statusLabel: '正常',
      },
    ],
    volumes: [
      {
        mount: '/volume1',
        device: '/dev/md0',
        fsType: 'btrfs',
        totalBytes: 2 * tib,
        usedBytes: 1.24 * tib,
        availableBytes: 0.76 * tib,
        usedPercent: 62.0,
        isVolume: true,
      },
      {
        mount: '/volume2',
        device: '/dev/md1',
        fsType: 'ext4',
        totalBytes: 8 * tib,
        usedBytes: 6.72 * tib,
        availableBytes: 1.28 * tib,
        usedPercent: 84.0,
        isVolume: true,
      },
    ],
    docker: dockerAvailable
      ? {
          available: true,
          containers: [
            {
              id: 'demo-homedash',
              name: 'homedash',
              image: 'homedash:latest',
              state: 'running',
              status: 'Up 18 days',
              runningFor: '18 days ago',
              ports: '0.0.0.0:3000->3000/tcp',
              cpuPercent: '0.45%',
              memUsage: '68.2MiB / 16GiB',
              memPercent: '0.42%',
            },
            {
              id: 'demo-qb',
              name: 'qbittorrent',
              image: 'linuxserver/qbittorrent:latest',
              state: 'running',
              status: 'Up 12 days',
              runningFor: '12 days ago',
              ports: '0.0.0.0:8080->8080/tcp',
              cpuPercent: '4.12%',
              memUsage: '512MiB / 16GiB',
              memPercent: '3.12%',
            },
            {
              id: 'demo-mp',
              name: 'moviepilot',
              image: 'jxxghp/moviepilot-v2:latest',
              state: 'running',
              status: 'Up 12 days',
              runningFor: '12 days ago',
              ports: '0.0.0.0:3001->3000/tcp',
              cpuPercent: '1.85%',
              memUsage: '380MiB / 16GiB',
              memPercent: '2.31%',
            },
            {
              id: 'demo-wt',
              name: 'watchtower',
              image: 'containrrr/watchtower:latest',
              state: 'exited',
              status: 'Exited (0) 2 days ago',
              runningFor: '30 days ago',
              ports: '',
            },
          ],
        }
      : {
          available: false,
          reason: '当前账号无权访问 Docker（需要加入 docker 组），已跳过',
          containers: [],
        },
  };
}

interface CacheEntry {
  expiresAtMs: number;
  response: NasStatusResponse;
}

/**
 * 创建 NAS 只读 SSH 状态采集服务（带缓存、并发复用与失败冷却）。
 */
export function createNasService(
  config: AppConfig,
  integrationsStore: IntegrationsStore,
  options?: CreateNasServiceOptions,
): NasService {
  const executor = options?.executor ?? executeSshCommand;
  const readPrivateKey = options?.readPrivateKey ?? defaultReadPrivateKey;
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;
  const timeoutMs =
    options?.timeoutMs ?? config.devices?.DEVICE_SSH_TIMEOUT_MS ?? DEFAULT_SSH_TIMEOUT_MS;

  let cachedEntry: CacheEntry | null = null;
  let inFlightPromise: Promise<NasStatusResponse> | null = null;

  function enrichDockerMetadata(data: NasStatusData): NasStatusData {
    const actionsEnabled = Boolean(config.nas?.DOCKER_ACTIONS_ENABLED);
    const protectedContainers = integrationsStore.getProtectedDockerContainers();
    const protectedSet = new Set(protectedContainers);

    return {
      ...data,
      docker: {
        ...data.docker,
        actionsEnabled,
        protectedContainers,
        containers: data.docker.containers.map((container) => ({
          ...container,
          protected: protectedSet.has(container.name),
        })),
      },
    };
  }

  async function collectOnce(): Promise<NasStatusResponse> {
    const resolved = integrationsStore.resolveNasConfig();
    if (resolved.mock) {
      const nowMs = getNow();
      return {
        configured: true,
        mock: true,
        online: true,
        checkedAt: new Date(nowMs).toISOString(),
        cached: false,
        data: enrichDockerMetadata(createMockNasStatus(nowMs)),
      };
    }

    if (
      !resolved.configured ||
      !resolved.host ||
      !resolved.port ||
      !resolved.user ||
      !resolved.keyPath
    ) {
      return {
        configured: false,
        mock: false,
        online: false,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        errorCode: 'UNCONFIGURED',
        error: '尚未配置 NAS 连接参数，请前往设置页完成配置',
      };
    }

    let privateKey: string | Buffer;
    try {
      privateKey = await readPrivateKey(resolved.keyPath);
    } catch {
      const finishedAt = getNow();
      const failure: NasStatusResponse = {
        configured: true,
        mock: false,
        online: false,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        errorCode: 'KEY_FILE_ERROR',
        error: 'SSH 密钥文件不存在或不可读，请检查密钥路径配置',
      };
      cachedEntry = { expiresAtMs: finishedAt + FAILURE_CACHE_MS, response: failure };
      logger?.warn('NAS 状态采集失败：SSH 密钥文件不存在或不可读');
      return failure;
    }

    try {
      const execResult = await executor({
        host: resolved.host,
        port: resolved.port,
        username: resolved.user,
        privateKey,
        command: NAS_READONLY_STATUS_COMMAND,
        timeoutMs,
      });

      if (execResult.code !== 0) {
        throw new DeviceStatusClassifiedError(
          'COMMAND_FAILED',
          `NAS 状态采集命令执行失败（退出码 ${execResult.code ?? '未知'}）`,
        );
      }

      const finishedAt = getNow();
      const data = enrichDockerMetadata(parseNasStatusOutput(execResult.stdout, finishedAt));
      const success: NasStatusResponse = {
        configured: true,
        mock: false,
        online: true,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        data,
      };

      const cacheTtlMs = resolved.cacheSeconds * 1000;
      if (cacheTtlMs > 0) {
        cachedEntry = { expiresAtMs: finishedAt + cacheTtlMs, response: success };
      } else {
        cachedEntry = null;
      }

      return success;
    } catch (error) {
      const classified = classifyDeviceError(error);
      const errorCode: NasErrorCode =
        classified.errorCode === 'OS_DETECT_FAILED' ? 'COMMAND_FAILED' : classified.errorCode;
      const finishedAt = getNow();
      const failure: NasStatusResponse = {
        configured: true,
        mock: false,
        online: false,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        errorCode,
        error: classified.error,
      };
      cachedEntry = { expiresAtMs: finishedAt + FAILURE_CACHE_MS, response: failure };
      logger?.warn(`NAS 状态采集失败（${errorCode}）：${classified.error}`);
      return failure;
    }
  }

  return {
    async getStatus(reqOptions?: { refresh?: boolean }): Promise<NasStatusResponse> {
      const resolved = integrationsStore.resolveNasConfig();
      if (resolved.mock) {
        return collectOnce();
      }
      if (!resolved.configured) {
        cachedEntry = null;
        return collectOnce();
      }

      const refresh = Boolean(reqOptions?.refresh);
      const nowMs = getNow();
      if (!refresh && cachedEntry && nowMs < cachedEntry.expiresAtMs) {
        return {
          ...cachedEntry.response,
          cached: true,
        };
      }

      if (inFlightPromise) {
        return inFlightPromise;
      }

      inFlightPromise = collectOnce().finally(() => {
        inFlightPromise = null;
      });
      return inFlightPromise;
    },

    async testConnection(override?: NasTestOverride): Promise<IntegrationTestResponse> {
      const startedAt = getNow();

      // 显式校验覆盖端口，避免非法端口静默回退
      if (override?.port !== undefined && override.port !== null && override.port !== '') {
        const portNum =
          typeof override.port === 'number' ? override.port : Number(override.port.trim());
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          return {
            ok: false,
            durationMs: Math.max(0, getNow() - startedAt),
            error: 'SSH 端口必须是 1 到 65535 之间的整数',
          };
        }
      }

      const resolved = integrationsStore.resolveNasConfig(override);
      if (!resolved.host || !resolved.port || !resolved.user || !resolved.keyPath) {
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: '请填写完整的 NAS 主机、端口、用户名与私钥路径',
        };
      }

      let privateKey: string | Buffer;
      try {
        privateKey = await readPrivateKey(resolved.keyPath);
      } catch {
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: 'SSH 密钥文件不存在或不可读，请检查密钥路径配置',
        };
      }

      try {
        const result = await executor({
          host: resolved.host,
          port: resolved.port,
          username: resolved.user,
          privateKey,
          command: UNIX_OS_PROBE_COMMAND,
          timeoutMs,
        });

        if (result.code !== 0) {
          return {
            ok: false,
            durationMs: Math.max(0, getNow() - startedAt),
            error: `远端探测命令执行失败（退出码 ${result.code ?? '未知'}）`,
          };
        }

        const systemName = result.stdout.trim().split(/\r?\n/)[0]?.trim() || 'Linux';
        return {
          ok: true,
          durationMs: Math.max(0, getNow() - startedAt),
          detail: `SSH 连接成功（内核：${systemName}）`,
        };
      } catch (error) {
        const classified = classifyDeviceError(error);
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: classified.error,
        };
      }
    },

    invalidateCache(): void {
      cachedEntry = null;
    },
  };
}
