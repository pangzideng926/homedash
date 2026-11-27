import fs from 'node:fs';
import type { AppConfig, SafeLogger } from '../config/index.js';
import type { WindowsStatusResponse } from '../windows/service.js';
import {
  LINUX_READONLY_STATUS_COMMAND,
  MACOS_READONLY_STATUS_COMMAND,
  UNIX_OS_PROBE_COMMAND,
  WINDOWS_OS_PROBE_COMMAND,
  WINDOWS_READONLY_STATUS_COMMAND,
} from './commands.js';
import {
  DeviceStatusClassifiedError,
  parseLinuxDeviceOutput,
  parseMacosDeviceOutput,
  parseWindowsDeviceOutput,
} from './parsers.js';
import { executeSshCommand, SshCollectorError, type SshCommandExecutor } from './ssh-executor.js';
import {
  deviceTestPayloadSchema,
  readDevicesList,
  resolveRepoRelativePath,
  saveDevicesList,
} from './store.js';
import type {
  DetectedOs,
  DeviceErrorCode,
  DeviceListResponse,
  DeviceRecord,
  DevicesStatusResponse,
  DeviceStatusData,
  DeviceStatusItem,
  DeviceTestResponse,
  SaveDevicesResult,
  TargetDeviceOs,
} from './types.js';

const FAILURE_CACHE_MS = 10_000;
const OS_DETECT_CACHE_MS = 10 * 60 * 1000;

export interface CreateDevicesServiceOptions {
  executor?: SshCommandExecutor;
  readPrivateKey?: (keyPath: string) => Promise<string | Buffer>;
  now?: () => number;
  logger?: SafeLogger;
}

export type TestDeviceConnectionResult =
  | { ok: true; data: DeviceTestResponse }
  | { ok: false; status: 400; error: string; details?: string[] };

export interface DevicesService {
  getDevices: () => DeviceListResponse;
  saveDevices: (rawBody: unknown) => SaveDevicesResult;
  getAllStatuses: (options?: { refresh?: boolean }) => Promise<DevicesStatusResponse>;
  getDeviceStatus: (
    id: string,
    options?: { refresh?: boolean },
  ) => Promise<{ found: true; data: DeviceStatusItem } | { found: false }>;
  testConnection: (rawBody: unknown) => Promise<TestDeviceConnectionResult>;
  getLegacyWindowsStatus: (options?: { refresh?: boolean }) => Promise<WindowsStatusResponse>;
}

async function defaultReadPrivateKey(keyPath: string): Promise<string> {
  const resolved = resolveRepoRelativePath(keyPath);
  return fs.promises.readFile(resolved, 'utf-8');
}

function resolveEffectiveTimeoutMs(config: AppConfig): number {
  if (config.keyPresence.DEVICE_SSH_TIMEOUT_MS && config.devices) {
    return config.devices.DEVICE_SSH_TIMEOUT_MS;
  }
  if (config.keyPresence.WIN_SSH_TIMEOUT_MS && config.windows) {
    return config.windows.WIN_SSH_TIMEOUT_MS;
  }
  return config.devices?.DEVICE_SSH_TIMEOUT_MS ?? config.windows?.WIN_SSH_TIMEOUT_MS ?? 8000;
}

function resolveEffectiveCacheSeconds(config: AppConfig): number {
  if (config.keyPresence.DEVICE_CACHE_SECONDS && config.devices) {
    return config.devices.DEVICE_CACHE_SECONDS;
  }
  if (config.keyPresence.WIN_CACHE_SECONDS && config.windows) {
    return config.windows.WIN_CACHE_SECONDS;
  }
  return config.devices?.DEVICE_CACHE_SECONDS ?? config.windows?.WIN_CACHE_SECONDS ?? 30;
}

/**
 * 将底层采集异常归类为安全的中文错误提示，绝不暴露私钥内容或路径。
 */
export function classifyDeviceError(error: unknown): {
  errorCode: DeviceErrorCode;
  error: string;
} {
  if (error instanceof DeviceStatusClassifiedError) {
    return { errorCode: error.code, error: error.message };
  }

  if (error instanceof SshCollectorError) {
    if (error.kind === 'TIMEOUT') {
      return { errorCode: 'TIMEOUT', error: '连接超时或采集命令执行超时，请检查主机是否在线' };
    }
    if (error.kind === 'AUTH_FAILED') {
      return { errorCode: 'AUTH_FAILED', error: 'SSH 认证失败，请检查用户名与私钥是否匹配' };
    }
    return {
      errorCode: 'CONNECTION_FAILED',
      error: '连接被拒绝或主机不可达，请检查主机地址、端口与 SSH 服务',
    };
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timed out') || msg.includes('timeout')) {
      return { errorCode: 'TIMEOUT', error: '连接超时或采集命令执行超时，请检查主机是否在线' };
    }
    if (msg.includes('authentication') || msg.includes('auth')) {
      return { errorCode: 'AUTH_FAILED', error: 'SSH 认证失败，请检查用户名与私钥是否匹配' };
    }
    if (
      msg.includes('econnrefused') ||
      msg.includes('ehostunreach') ||
      msg.includes('enetunreach') ||
      msg.includes('enotfound')
    ) {
      return {
        errorCode: 'CONNECTION_FAILED',
        error: '连接被拒绝或主机不可达，请检查主机地址、端口与 SSH 服务',
      };
    }
  }

  return {
    errorCode: 'CONNECTION_FAILED',
    error: '连接设备失败，请稍后重试',
  };
}

/**
 * 生成模拟多设备状态（1 台 Windows + 1 台 macOS，全部占位数据）。
 */
export function createMockDeviceStatuses(nowMs: number = Date.now()): DeviceStatusItem[] {
  const checkedAt = new Date(nowMs).toISOString();
  const gib = 1024 * 1024 * 1024;

  const winUptime = 3 * 86400 + 7 * 3600 + 25 * 60;
  const macUptime = 12 * 86400 + 4 * 3600 + 10 * 60;

  return [
    {
      id: 'mock-windows',
      name: 'Windows 主力机（模拟）',
      os: 'windows',
      online: true,
      checkedAt,
      cached: false,
      data: {
        hostname: 'DEMO-PC',
        os: 'windows',
        osVersion: 'Microsoft Windows 11 Pro 10.0.22631',
        bootTime: new Date(nowMs - winUptime * 1000).toISOString(),
        uptimeSeconds: winUptime,
        cpu: {
          model: 'Demo Processor 12-Core @ 3.60GHz',
          cores: 12,
          loadPercent: 24.5,
        },
        memory: {
          totalBytes: 32 * gib,
          usedBytes: 14 * gib,
          usedPercent: 43.8,
        },
        disks: [
          {
            mount: 'C:',
            label: '系统盘',
            totalBytes: 500 * gib,
            freeBytes: 180 * gib,
            usedPercent: 64.0,
          },
          {
            mount: 'D:',
            label: '游戏与软件',
            totalBytes: 1000 * gib,
            freeBytes: 210 * gib,
            usedPercent: 79.0,
          },
          {
            mount: 'E:',
            label: '媒体归档',
            totalBytes: 2000 * gib,
            freeBytes: 140 * gib,
            usedPercent: 93.0,
          },
        ],
      },
    },
    {
      id: 'mock-macos',
      name: 'Mac mini（模拟）',
      os: 'macos',
      online: true,
      checkedAt,
      cached: false,
      data: {
        hostname: 'DEMO-MAC',
        os: 'macos',
        osVersion: 'macOS 15.1 (24B83)',
        bootTime: new Date(nowMs - macUptime * 1000).toISOString(),
        uptimeSeconds: macUptime,
        cpu: {
          model: 'Apple M2 Pro (Demo)',
          cores: 10,
          loadPercent: 18.2,
        },
        memory: {
          totalBytes: 16 * gib,
          usedBytes: 10.4 * gib,
          usedPercent: 65.0,
        },
        disks: [
          {
            mount: '/System/Volumes/Data',
            label: '系统盘',
            totalBytes: 512 * gib,
            freeBytes: 190 * gib,
            usedPercent: 62.9,
          },
          {
            mount: '/Volumes/TimeMachine',
            label: 'TimeMachine',
            totalBytes: 2000 * gib,
            freeBytes: 360 * gib,
            usedPercent: 82.0,
          },
        ],
      },
    },
  ];
}

function mapDeviceStatusToLegacyWindows(item: DeviceStatusItem): WindowsStatusResponse {
  if (!item.online || !item.data) {
    const legacyCode =
      item.errorCode === 'OS_DETECT_FAILED'
        ? 'COMMAND_FAILED'
        : ((item.errorCode ?? 'CONNECTION_FAILED') as WindowsStatusResponse['errorCode']);
    return {
      online: false,
      checkedAt: item.checkedAt,
      cached: item.cached,
      errorCode: legacyCode,
      error: item.error ?? '家用电脑当前离线或采集失败',
    };
  }

  const totalBytes = item.data.memory.totalBytes;
  const freeBytes = Math.max(0, totalBytes - item.data.memory.usedBytes);

  return {
    online: true,
    checkedAt: item.checkedAt,
    cached: item.cached,
    data: {
      hostname: item.data.hostname,
      os: item.data.osVersion,
      bootTime: item.data.bootTime,
      uptimeSeconds: item.data.uptimeSeconds,
      cpu: {
        model: item.data.cpu.model,
        loadPercent: item.data.cpu.loadPercent,
      },
      memory: {
        totalBytes,
        freeBytes,
        usedPercent: item.data.memory.usedPercent,
      },
      disks: item.data.disks.map((disk) => ({
        drive: disk.mount,
        label: disk.label,
        totalBytes: disk.totalBytes,
        freeBytes: disk.freeBytes,
        usedPercent: disk.usedPercent,
      })),
    },
  };
}

interface CacheEntry {
  expiresAtMs: number;
  item: DeviceStatusItem;
}

interface OsCacheEntry {
  os: TargetDeviceOs;
  expiresAtMs: number;
}

/**
 * 创建多设备 SSH 只读采集与管理服务（支持每台设备独立缓存、并发复用与 10 分钟系统识别缓存）。
 */
export function createDevicesService(
  config: AppConfig,
  options?: CreateDevicesServiceOptions,
): DevicesService {
  const executor = options?.executor ?? executeSshCommand;
  const readPrivateKey = options?.readPrivateKey ?? defaultReadPrivateKey;
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;

  const statusCache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<DeviceStatusItem>>();
  const osDetectCache = new Map<string, OsCacheEntry>();

  const timeoutMs = resolveEffectiveTimeoutMs(config);
  const cacheSeconds = resolveEffectiveCacheSeconds(config);

  function buildOsCacheKey(device: Pick<DeviceRecord, 'id' | 'host' | 'port' | 'user'>): string {
    return `${device.id}|${device.host}|${device.port}|${device.user}`;
  }

  async function detectDeviceOs(params: {
    host: string;
    port: number;
    username: string;
    privateKey: string | Buffer;
  }): Promise<TargetDeviceOs> {
    const unixResult = await executor({
      ...params,
      command: UNIX_OS_PROBE_COMMAND,
      timeoutMs,
    });

    if (unixResult.code === 0) {
      const firstLine = unixResult.stdout.trim().split(/\r?\n/)[0]?.trim().toLowerCase() ?? '';
      if (firstLine === 'darwin') return 'macos';
      if (firstLine === 'linux') return 'linux';
    }

    const winResult = await executor({
      ...params,
      command: WINDOWS_OS_PROBE_COMMAND,
      timeoutMs,
    });

    if (winResult.code === 0 && /^\d+/.test(winResult.stdout.trim())) {
      return 'windows';
    }

    throw new DeviceStatusClassifiedError('OS_DETECT_FAILED', '系统识别失败，无法判定目标主机系统');
  }

  async function resolveTargetOs(
    device: DeviceRecord,
    privateKey: string | Buffer,
  ): Promise<TargetDeviceOs> {
    if (device.os !== 'auto') {
      return device.os;
    }

    const cacheKey = buildOsCacheKey(device);
    const cachedOs = osDetectCache.get(cacheKey);
    const nowMs = getNow();
    if (cachedOs && nowMs < cachedOs.expiresAtMs) {
      return cachedOs.os;
    }

    const detected = await detectDeviceOs({
      host: device.host,
      port: device.port,
      username: device.user,
      privateKey,
    });

    osDetectCache.set(cacheKey, {
      os: detected,
      expiresAtMs: getNow() + OS_DETECT_CACHE_MS,
    });
    return detected;
  }

  function parseOutputByOs(os: TargetDeviceOs, stdout: string, nowMs: number): DeviceStatusData {
    if (os === 'windows') {
      return parseWindowsDeviceOutput(stdout);
    }
    if (os === 'macos') {
      return parseMacosDeviceOutput(stdout, nowMs);
    }
    return parseLinuxDeviceOutput(stdout, nowMs);
  }

  function getCommandByOs(os: TargetDeviceOs): string {
    if (os === 'windows') return WINDOWS_READONLY_STATUS_COMMAND;
    if (os === 'macos') return MACOS_READONLY_STATUS_COMMAND;
    return LINUX_READONLY_STATUS_COMMAND;
  }

  async function collectSingleDeviceOnce(device: DeviceRecord): Promise<DeviceStatusItem> {
    const initialOs: DetectedOs = device.os === 'auto' ? 'unknown' : device.os;

    let privateKey: string | Buffer;
    try {
      privateKey = await readPrivateKey(device.keyPath);
    } catch {
      const finishedAt = getNow();
      const failure: DeviceStatusItem = {
        id: device.id,
        name: device.name,
        os: initialOs,
        online: false,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        errorCode: 'KEY_FILE_ERROR',
        error: 'SSH 密钥文件不存在或不可读，请检查密钥路径配置',
      };
      statusCache.set(device.id, {
        expiresAtMs: finishedAt + FAILURE_CACHE_MS,
        item: failure,
      });
      logger?.warn(`设备 ${device.name}（${device.id}）状态采集失败：密钥文件不存在或不可读`);
      return failure;
    }

    let resolvedOs: DetectedOs = initialOs;
    try {
      const targetOs = await resolveTargetOs(device, privateKey);
      resolvedOs = targetOs;

      const execResult = await executor({
        host: device.host,
        port: device.port,
        username: device.user,
        privateKey,
        command: getCommandByOs(targetOs),
        timeoutMs,
      });

      if (execResult.code !== 0) {
        throw new DeviceStatusClassifiedError(
          'COMMAND_FAILED',
          `远端状态采集命令执行失败（退出码 ${execResult.code ?? '未知'}）`,
        );
      }

      const finishedAt = getNow();
      const data = parseOutputByOs(targetOs, execResult.stdout, finishedAt);
      const success: DeviceStatusItem = {
        id: device.id,
        name: device.name,
        os: targetOs,
        online: true,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        data,
      };

      const cacheTtlMs = cacheSeconds * 1000;
      if (cacheTtlMs > 0) {
        statusCache.set(device.id, {
          expiresAtMs: finishedAt + cacheTtlMs,
          item: success,
        });
      } else {
        statusCache.delete(device.id);
      }

      return success;
    } catch (error) {
      const classified = classifyDeviceError(error);
      const finishedAt = getNow();
      const failure: DeviceStatusItem = {
        id: device.id,
        name: device.name,
        os: resolvedOs,
        online: false,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        errorCode: classified.errorCode,
        error: classified.error,
      };
      statusCache.set(device.id, {
        expiresAtMs: finishedAt + FAILURE_CACHE_MS,
        item: failure,
      });
      logger?.warn(
        `设备 ${device.name}（${device.id}）状态采集失败（${classified.errorCode}）：${classified.error}`,
      );
      return failure;
    }
  }

  async function getDeviceStatusInternal(
    device: DeviceRecord,
    refresh: boolean,
  ): Promise<DeviceStatusItem> {
    const nowMs = getNow();
    const cached = statusCache.get(device.id);
    if (!refresh && cached && nowMs < cached.expiresAtMs) {
      return {
        ...cached.item,
        cached: true,
      };
    }

    const running = inFlight.get(device.id);
    if (running) {
      return running;
    }

    const promise = collectSingleDeviceOnce(device).finally(() => {
      inFlight.delete(device.id);
    });
    inFlight.set(device.id, promise);
    return promise;
  }

  return {
    getDevices(): DeviceListResponse {
      return readDevicesList(config);
    },

    saveDevices(rawBody: unknown): SaveDevicesResult {
      const result = saveDevicesList(config, rawBody);
      if (result.ok) {
        statusCache.clear();
        osDetectCache.clear();
      }
      return result;
    },

    async getAllStatuses(reqOptions?: { refresh?: boolean }): Promise<DevicesStatusResponse> {
      const list = readDevicesList(config);
      const checkedAt = new Date(getNow()).toISOString();

      if (!list.configured || list.error) {
        return {
          configured: list.configured,
          source: list.source,
          readonly: list.readonly,
          ...(list.readonlyReason ? { readonlyReason: list.readonlyReason } : {}),
          checkedAt,
          devices: [],
          summary: { total: 0, online: 0, offline: 0 },
          ...(list.errorCode ? { errorCode: list.errorCode } : {}),
          ...(list.error ? { error: list.error } : {}),
        };
      }

      if (list.source === 'mock') {
        const mockDevices = createMockDeviceStatuses(getNow());
        const onlineCount = mockDevices.filter((d) => d.online).length;
        return {
          configured: true,
          source: 'mock',
          readonly: true,
          ...(list.readonlyReason ? { readonlyReason: list.readonlyReason } : {}),
          checkedAt,
          devices: mockDevices,
          summary: {
            total: mockDevices.length,
            online: onlineCount,
            offline: mockDevices.length - onlineCount,
          },
        };
      }

      const refresh = Boolean(reqOptions?.refresh);
      const enabledDevices = list.devices.filter((d) => d.enabled);
      const items = await Promise.all(
        enabledDevices.map((device) => getDeviceStatusInternal(device, refresh)),
      );
      const online = items.filter((item) => item.online).length;

      return {
        configured: true,
        source: list.source,
        readonly: list.readonly,
        ...(list.readonlyReason ? { readonlyReason: list.readonlyReason } : {}),
        checkedAt: new Date(getNow()).toISOString(),
        devices: items,
        summary: {
          total: items.length,
          online,
          offline: items.length - online,
        },
      };
    },

    async getDeviceStatus(
      id: string,
      reqOptions?: { refresh?: boolean },
    ): Promise<{ found: true; data: DeviceStatusItem } | { found: false }> {
      const list = readDevicesList(config);
      if (!list.configured || list.error) {
        return { found: false };
      }

      if (list.source === 'mock') {
        const found = createMockDeviceStatuses(getNow()).find((d) => d.id === id);
        return found ? { found: true, data: found } : { found: false };
      }

      const target = list.devices.find((d) => d.id === id);
      if (!target) {
        return { found: false };
      }

      const data = await getDeviceStatusInternal(target, Boolean(reqOptions?.refresh));
      return { found: true, data };
    },

    async testConnection(rawBody: unknown): Promise<TestDeviceConnectionResult> {
      const parsed = deviceTestPayloadSchema.safeParse(rawBody);
      if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => {
          const pathText = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
          return `${pathText}${issue.message}`;
        });
        return {
          ok: false,
          status: 400,
          error: `参数校验失败：${details[0] ?? '请检查输入格式'}`,
          details,
        };
      }

      const input = parsed.data;
      const startedAt = getNow();

      let privateKey: string | Buffer;
      try {
        privateKey = await readPrivateKey(input.keyPath);
      } catch {
        return {
          ok: true,
          data: {
            ok: false,
            durationMs: Math.max(0, getNow() - startedAt),
            errorCode: 'KEY_FILE_ERROR',
            error: 'SSH 密钥文件不存在或不可读，请检查密钥路径配置',
          },
        };
      }

      try {
        let detectedOs: TargetDeviceOs;
        if (input.os === 'auto') {
          detectedOs = await detectDeviceOs({
            host: input.host,
            port: input.port,
            username: input.user,
            privateKey,
          });
        } else if (input.os === 'windows') {
          const winProbe = await executor({
            host: input.host,
            port: input.port,
            username: input.user,
            privateKey,
            command: WINDOWS_OS_PROBE_COMMAND,
            timeoutMs,
          });
          if (winProbe.code !== 0) {
            throw new DeviceStatusClassifiedError(
              'COMMAND_FAILED',
              `远端探测命令执行失败（退出码 ${winProbe.code ?? '未知'}）`,
            );
          }
          detectedOs = 'windows';
        } else {
          const unixProbe = await executor({
            host: input.host,
            port: input.port,
            username: input.user,
            privateKey,
            command: UNIX_OS_PROBE_COMMAND,
            timeoutMs,
          });
          if (unixProbe.code !== 0) {
            throw new DeviceStatusClassifiedError(
              'COMMAND_FAILED',
              `远端探测命令执行失败（退出码 ${unixProbe.code ?? '未知'}）`,
            );
          }
          detectedOs = input.os;
        }

        return {
          ok: true,
          data: {
            ok: true,
            os: detectedOs,
            durationMs: Math.max(0, getNow() - startedAt),
          },
        };
      } catch (error) {
        const classified = classifyDeviceError(error);
        return {
          ok: true,
          data: {
            ok: false,
            durationMs: Math.max(0, getNow() - startedAt),
            errorCode: classified.errorCode,
            error: classified.error,
          },
        };
      }
    },

    async getLegacyWindowsStatus(reqOptions?: {
      refresh?: boolean;
    }): Promise<WindowsStatusResponse> {
      const list = readDevicesList(config);
      if (!list.configured) {
        return {
          online: false,
          checkedAt: new Date(getNow()).toISOString(),
          cached: false,
          errorCode: 'UNCONFIGURED',
          error: '尚未配置家用 Windows 主机连接参数',
        };
      }

      if (list.error) {
        return {
          online: false,
          checkedAt: new Date(getNow()).toISOString(),
          cached: false,
          errorCode: 'COMMAND_FAILED',
          error: list.error,
        };
      }

      if (list.source === 'mock') {
        const mockWin = createMockDeviceStatuses(getNow()).find((d) => d.os === 'windows');
        if (!mockWin) {
          return {
            online: false,
            checkedAt: new Date(getNow()).toISOString(),
            cached: false,
            errorCode: 'UNCONFIGURED',
            error: '尚未配置家用 Windows 主机连接参数',
          };
        }
        return mapDeviceStatusToLegacyWindows(mockWin);
      }

      const firstWindows =
        list.devices.find((d) => d.enabled && d.os === 'windows') ??
        list.devices.find((d) => d.enabled);

      if (!firstWindows) {
        return {
          online: false,
          checkedAt: new Date(getNow()).toISOString(),
          cached: false,
          errorCode: 'UNCONFIGURED',
          error: '尚未配置启用的家用 Windows 主机',
        };
      }

      const item = await getDeviceStatusInternal(firstWindows, Boolean(reqOptions?.refresh));
      return mapDeviceStatusToLegacyWindows(item);
    },
  };
}
