import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT, type AppConfig, type SafeLogger } from '../config/index.js';
import { WINDOWS_READONLY_STATUS_COMMAND } from './command.js';
import {
  executeSshCommand,
  WindowsCollectorError,
  type WindowsCommandExecutor,
} from './ssh-executor.js';

export type WindowsErrorCode =
  | 'UNCONFIGURED'
  | 'KEY_FILE_ERROR'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'CONNECTION_FAILED'
  | 'COMMAND_FAILED'
  | 'PARSE_FAILED';

export interface WindowsCpuInfo {
  model: string;
  loadPercent: number;
}

export interface WindowsMemoryInfo {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface WindowsDiskInfo {
  drive: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface WindowsStatusData {
  hostname: string;
  os: string;
  bootTime: string;
  uptimeSeconds: number;
  cpu: WindowsCpuInfo;
  memory: WindowsMemoryInfo;
  disks: WindowsDiskInfo[];
}

export interface WindowsStatusResponse {
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: WindowsErrorCode;
  error?: string;
  data?: WindowsStatusData;
}

export interface WindowsStatusService {
  getStatus: (options?: { refresh?: boolean }) => Promise<WindowsStatusResponse>;
}

export interface CreateWindowsStatusServiceOptions {
  executor?: WindowsCommandExecutor;
  readPrivateKey?: (keyPath: string) => Promise<string | Buffer>;
  now?: () => number;
  logger?: SafeLogger;
}

const FAILURE_CACHE_MS = 10_000;

const rawDiskSchema = z.object({
  drive: z.string().min(1),
  label: z.string().optional().default(''),
  totalBytes: z.number().finite().nonnegative(),
  freeBytes: z.number().finite().nonnegative(),
});

const rawWindowsPayloadSchema = z.object({
  hostname: z.string().min(1),
  os: z.string().min(1),
  bootTime: z.string().min(1),
  uptimeSeconds: z.number().finite().nonnegative(),
  cpu: z.object({
    model: z.string().min(1),
    loadPercent: z.number().finite().min(0).max(100),
  }),
  memory: z.object({
    totalBytes: z.number().finite().positive(),
    freeBytes: z.number().finite().nonnegative(),
  }),
  disks: z
    .union([z.array(rawDiskSchema), rawDiskSchema, z.null(), z.undefined()])
    .transform((val) => {
      if (!val) return [];
      return Array.isArray(val) ? val : [val];
    }),
});

class WindowsStatusClassifiedError extends Error {
  readonly code: WindowsErrorCode;

  constructor(code: WindowsErrorCode, message: string) {
    super(message);
    this.name = 'WindowsStatusClassifiedError';
    this.code = code;
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function calcUsedPercent(totalBytes: number, freeBytes: number): number {
  if (totalBytes <= 0) return 0;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return clampPercent((usedBytes / totalBytes) * 100);
}

/**
 * 解析 PowerShell 输出的压缩 JSON，兼容单块磁盘被序列化为对象而非数组的情况。
 */
export function parseWindowsStatusOutput(stdout: string): WindowsStatusData {
  const cleaned = stdout.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    throw new WindowsStatusClassifiedError('PARSE_FAILED', '采集输出解析失败，返回内容为空');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new WindowsStatusClassifiedError('PARSE_FAILED', '采集输出解析失败，JSON 格式无效');
  }

  const result = rawWindowsPayloadSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new WindowsStatusClassifiedError('PARSE_FAILED', '采集输出解析失败，字段结构不符合预期');
  }

  const raw = result.data;
  return {
    hostname: raw.hostname.trim(),
    os: raw.os.trim(),
    bootTime: raw.bootTime,
    uptimeSeconds: Math.floor(raw.uptimeSeconds),
    cpu: {
      model: raw.cpu.model.trim(),
      loadPercent: clampPercent(raw.cpu.loadPercent),
    },
    memory: {
      totalBytes: raw.memory.totalBytes,
      freeBytes: Math.min(raw.memory.freeBytes, raw.memory.totalBytes),
      usedPercent: calcUsedPercent(raw.memory.totalBytes, raw.memory.freeBytes),
    },
    disks: raw.disks.map((disk) => ({
      drive: disk.drive.trim(),
      label: disk.label.trim(),
      totalBytes: disk.totalBytes,
      freeBytes: Math.min(disk.freeBytes, disk.totalBytes),
      usedPercent: calcUsedPercent(disk.totalBytes, disk.freeBytes),
    })),
  };
}

/**
 * 将底层采集异常归类为安全的中文错误提示，不暴露私钥内容或敏感连接信息。
 */
export function classifyWindowsError(error: unknown): {
  errorCode: WindowsErrorCode;
  error: string;
} {
  if (error instanceof WindowsStatusClassifiedError) {
    return { errorCode: error.code, error: error.message };
  }

  if (error instanceof WindowsCollectorError) {
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
    error: '连接家用电脑失败，请稍后重试',
  };
}

function resolveKeyFilePath(configuredPath: string): string {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  const cwdCandidate = path.resolve(process.cwd(), configuredPath);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }
  const repoCandidate = path.resolve(REPO_ROOT, configuredPath);
  if (fs.existsSync(repoCandidate)) {
    return repoCandidate;
  }
  return cwdCandidate;
}

async function defaultReadPrivateKey(keyPath: string): Promise<string> {
  const resolved = resolveKeyFilePath(keyPath);
  return fs.promises.readFile(resolved, 'utf-8');
}

/**
 * 返回固定模拟数据（WIN_MOCK=true 时用于开发与演示）。
 */
export function createMockWindowsStatus(nowMs: number = Date.now()): WindowsStatusResponse {
  const uptimeSeconds = 3 * 86400 + 7 * 3600 + 25 * 60;
  const bootTime = new Date(nowMs - uptimeSeconds * 1000).toISOString();
  const gib = 1024 * 1024 * 1024;

  return {
    online: true,
    checkedAt: new Date(nowMs).toISOString(),
    cached: false,
    data: {
      hostname: 'DEMO-PC',
      os: 'Microsoft Windows 11 Pro 10.0.22631',
      bootTime,
      uptimeSeconds,
      cpu: {
        model: 'Demo Processor 12-Core @ 3.60GHz',
        loadPercent: 24.5,
      },
      memory: {
        totalBytes: 32 * gib,
        freeBytes: 18 * gib,
        usedPercent: 43.8,
      },
      disks: [
        {
          drive: 'C:',
          label: '系统盘',
          totalBytes: 500 * gib,
          freeBytes: 180 * gib,
          usedPercent: 64.0,
        },
        {
          drive: 'D:',
          label: '游戏与软件',
          totalBytes: 1000 * gib,
          freeBytes: 210 * gib,
          usedPercent: 79.0,
        },
        {
          drive: 'E:',
          label: '媒体归档',
          totalBytes: 2000 * gib,
          freeBytes: 140 * gib,
          usedPercent: 93.0,
        },
      ],
    },
  };
}

interface CacheEntry {
  expiresAtMs: number;
  response: WindowsStatusResponse;
}

/**
 * 创建 Windows 状态采集服务（带成功/失败缓存与并发请求复用）。
 */
export function createWindowsStatusService(
  config: AppConfig,
  options?: CreateWindowsStatusServiceOptions,
): WindowsStatusService {
  const executor = options?.executor ?? executeSshCommand;
  const readPrivateKey = options?.readPrivateKey ?? defaultReadPrivateKey;
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;

  let cachedEntry: CacheEntry | null = null;
  let inFlight: Promise<WindowsStatusResponse> | null = null;

  const collectOnce = async (): Promise<WindowsStatusResponse> => {
    const winConfig = config.windows;
    if (!winConfig) {
      return {
        online: false,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        errorCode: 'UNCONFIGURED',
        error: '尚未配置家用 Windows 主机连接参数',
      };
    }

    if (winConfig.WIN_MOCK) {
      return createMockWindowsStatus(getNow());
    }

    const host = winConfig.WIN_SSH_HOST;
    const port = winConfig.WIN_SSH_PORT;
    const username = winConfig.WIN_SSH_USER;
    const keyPath = winConfig.WIN_SSH_KEY_PATH;

    if (!host || !port || !username || !keyPath) {
      return {
        online: false,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        errorCode: 'UNCONFIGURED',
        error: '家用 Windows 主机 SSH 配置不完整',
      };
    }

    let privateKey: string | Buffer;
    try {
      privateKey = await readPrivateKey(keyPath);
    } catch {
      const failure: WindowsStatusResponse = {
        online: false,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        errorCode: 'KEY_FILE_ERROR',
        error: 'SSH 密钥文件不存在或不可读，请检查 WIN_SSH_KEY_PATH 配置',
      };
      cachedEntry = {
        expiresAtMs: getNow() + FAILURE_CACHE_MS,
        response: failure,
      };
      logger?.warn('Windows 状态采集失败：密钥文件不存在或不可读');
      return failure;
    }

    try {
      const execResult = await executor({
        host,
        port,
        username,
        privateKey,
        command: WINDOWS_READONLY_STATUS_COMMAND,
        timeoutMs: winConfig.WIN_SSH_TIMEOUT_MS,
      });

      if (execResult.code !== 0) {
        throw new WindowsStatusClassifiedError(
          'COMMAND_FAILED',
          `远端状态采集命令执行失败（退出码 ${execResult.code ?? '未知'}）`,
        );
      }

      const data = parseWindowsStatusOutput(execResult.stdout);
      const finishedAt = getNow();
      const success: WindowsStatusResponse = {
        online: true,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        data,
      };

      const cacheTtlMs = winConfig.WIN_CACHE_SECONDS * 1000;
      if (cacheTtlMs > 0) {
        cachedEntry = {
          expiresAtMs: finishedAt + cacheTtlMs,
          response: success,
        };
      } else {
        cachedEntry = null;
      }

      return success;
    } catch (error) {
      const classified = classifyWindowsError(error);
      const finishedAt = getNow();
      const failure: WindowsStatusResponse = {
        online: false,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        errorCode: classified.errorCode,
        error: classified.error,
      };
      cachedEntry = {
        expiresAtMs: finishedAt + FAILURE_CACHE_MS,
        response: failure,
      };
      logger?.warn(`Windows 状态采集失败（${classified.errorCode}）：${classified.error}`);
      return failure;
    }
  };

  return {
    async getStatus(reqOptions?: { refresh?: boolean }): Promise<WindowsStatusResponse> {
      const winConfig = config.windows;
      if (!winConfig) {
        return {
          online: false,
          checkedAt: new Date(getNow()).toISOString(),
          cached: false,
          errorCode: 'UNCONFIGURED',
          error: '尚未配置家用 Windows 主机连接参数',
        };
      }

      if (winConfig.WIN_MOCK) {
        return createMockWindowsStatus(getNow());
      }

      const refresh = Boolean(reqOptions?.refresh);
      const nowMs = getNow();

      if (!refresh && cachedEntry && nowMs < cachedEntry.expiresAtMs) {
        return {
          ...cachedEntry.response,
          cached: true,
        };
      }

      if (inFlight) {
        return inFlight;
      }

      inFlight = collectOnce().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
