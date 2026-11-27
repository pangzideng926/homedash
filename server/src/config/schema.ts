import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import {
  ALL_CONFIG_KEYS,
  CONFIG_MODULE_KEYS,
  CONFIG_MODULE_LABELS,
  WINDOWS_SSH_REQUIRED_KEYS,
  type AppConfig,
  type AppSectionConfig,
  type AuthSectionConfig,
  type ConfigKey,
  type ConfigModuleName,
  type DevicesSectionConfig,
  type DownloadersSectionConfig,
  type MoviepilotSectionConfig,
  type NasSectionConfig,
  type QbittorrentSectionConfig,
  type VpsSectionConfig,
  type WindowsSectionConfig,
} from './definitions.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(currentDir, '../..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

export interface ConfigIssue {
  module: ConfigModuleName;
  key: string;
  reason: string;
}

/**
 * 配置校验异常：仅记录模块、变量名与错误原因，绝不包含任何环境变量值。
 */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(formatConfigIssues(issues));
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function formatConfigIssues(issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => {
    const label = CONFIG_MODULE_LABELS[issue.module];
    return `  - [${label}] ${issue.key}：${issue.reason}`;
  });
  return ['配置校验失败，请检查环境变量或 .env 文件：', ...lines].join('\n');
}

export function formatConfigError(error: ConfigError): string {
  return formatConfigIssues(error.issues);
}

/**
 * 依次尝试加载 server 目录、仓库根目录和当前工作目录下的 .env 文件。
 * dotenv 默认不会覆盖已经存在的 process.env 变量。
 */
export function loadEnvFiles(): void {
  const candidates = [
    path.resolve(SERVER_ROOT, '.env'),
    path.resolve(REPO_ROOT, '.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  const visited = new Set<string>();

  for (const envPath of candidates) {
    if (visited.has(envPath)) continue;
    visited.add(envPath);
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
    }
  }
}

export function isEnvValueFilled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value === undefined ? undefined : String(value);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const nonEmptyStringSchema = (label: string) =>
  z
    .string({ message: `${label}必须填写` })
    .trim()
    .min(1, `${label}不能为空`);

const booleanStringSchema = z
  .string({ message: '必须为布尔值（true/false/1/0/yes/no）' })
  .trim()
  .toLowerCase()
  .refine((val) => ['true', 'false', '1', '0', 'yes', 'no'].includes(val), {
    message: '必须为布尔值（true/false/1/0/yes/no）',
  })
  .transform((val) => val === 'true' || val === '1' || val === 'yes');

const portSchema = z
  .string({ message: '端口必须是 1 到 65535 之间的整数' })
  .trim()
  .refine(
    (val) => {
      if (!/^\d+$/.test(val)) return false;
      const num = Number(val);
      return Number.isInteger(num) && num >= 1 && num <= 65535;
    },
    { message: '端口必须是 1 到 65535 之间的整数' },
  )
  .transform((val) => Number(val));

const positiveIntSchema = (label: string) =>
  z
    .string({ message: `${label}必须是大于 0 的整数` })
    .trim()
    .refine(
      (val) => {
        if (!/^\d+$/.test(val)) return false;
        const num = Number(val);
        return Number.isSafeInteger(num) && num >= 1;
      },
      { message: `${label}必须是大于 0 的整数` },
    )
    .transform((val) => Number(val));

const nonNegativeIntSchema = (label: string) =>
  z
    .string({ message: `${label}必须是大于或等于 0 的整数` })
    .trim()
    .refine(
      (val) => {
        if (!/^\d+$/.test(val)) return false;
        const num = Number(val);
        return Number.isSafeInteger(num) && num >= 0;
      },
      { message: `${label}必须是大于或等于 0 的整数` },
    )
    .transform((val) => Number(val));

const intInRangeSchema = (label: string, min: number, max: number) =>
  z
    .string({ message: `${label}必须是 ${min} 到 ${max} 之间的整数` })
    .trim()
    .refine(
      (val) => {
        if (!/^\d+$/.test(val)) return false;
        const num = Number(val);
        return Number.isSafeInteger(num) && num >= min && num <= max;
      },
      { message: `${label}必须是 ${min} 到 ${max} 之间的整数` },
    )
    .transform((val) => Number(val));

const timeZoneSchema = z
  .string({ message: '必须是有效的 IANA 时区名称（例如 Asia/Shanghai）' })
  .trim()
  .refine(
    (val) => {
      if (!val) return false;
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: val });
        return true;
      } catch {
        return false;
      }
    },
    { message: '必须是有效的 IANA 时区名称（例如 Asia/Shanghai）' },
  );

const httpUrlSchema = z
  .string({ message: '必须是有效的 http:// 或 https:// 地址' })
  .trim()
  .refine(
    (val) => {
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: '必须是有效的 http:// 或 https:// 地址' },
  );

const nodeEnvSchema = z
  .string({ message: '必须是 development、production 或 test 之一' })
  .trim()
  .refine(
    (val): val is 'development' | 'production' | 'test' =>
      val === 'development' || val === 'production' || val === 'test',
    { message: '必须是 development、production 或 test 之一' },
  );

const appEnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, nodeEnvSchema.default('development')),
  PORT: z.preprocess(emptyToUndefined, portSchema.default(3000)),
  HOST: z.preprocess(emptyToUndefined, nonEmptyStringSchema('监听地址').default('0.0.0.0')),
  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    nonEmptyStringSchema('数据库路径').default('file:./data/homedash.db'),
  ),
  WEB_DIST_DIR: z.preprocess(emptyToUndefined, nonEmptyStringSchema('前端产物目录').optional()),
  COOKIE_SECURE: z.preprocess(emptyToUndefined, booleanStringSchema.optional()),
  TRUST_PROXY: z.preprocess(emptyToUndefined, booleanStringSchema.default(false)),
  TZ_DISPLAY: z.preprocess(emptyToUndefined, timeZoneSchema.default('Asia/Shanghai')),
  INTEGRATIONS_FILE: z.preprocess(
    emptyToUndefined,
    nonEmptyStringSchema('集成凭据文件路径').optional(),
  ),
  CONFIG_ENCRYPTION_KEY: z.preprocess(
    emptyToUndefined,
    z.string().min(32, '长度至少需要 32 个字符').optional(),
  ),
});

const authEnvSchema = z.object({
  ADMIN_USERNAME: z.preprocess(emptyToUndefined, nonEmptyStringSchema('管理员用户名')),
  ADMIN_PASSWORD_HASH: z.preprocess(emptyToUndefined, nonEmptyStringSchema('管理员密码哈希')),
  SESSION_SECRET: z.preprocess(
    emptyToUndefined,
    z
      .string({ message: '必须填写会话签名密钥（长度至少 32 个字符）' })
      .min(32, '长度至少需要 32 个字符'),
  ),
  SESSION_TTL_HOURS: z.preprocess(
    emptyToUndefined,
    positiveIntSchema('会话有效期小时数').default(168),
  ),
  LOGIN_MAX_ATTEMPTS: z.preprocess(
    emptyToUndefined,
    positiveIntSchema('最大登录失败次数').default(5),
  ),
  LOGIN_LOCK_MINUTES: z.preprocess(emptyToUndefined, positiveIntSchema('登录锁定时长').default(15)),
});

const nasFieldSchemas = {
  NAS_SSH_HOST: nonEmptyStringSchema('NAS SSH 主机'),
  NAS_SSH_PORT: portSchema,
  NAS_SSH_USER: nonEmptyStringSchema('NAS SSH 用户名'),
  NAS_SSH_KEY_PATH: nonEmptyStringSchema('NAS SSH 私钥路径'),
  NAS_MOCK: booleanStringSchema,
  NAS_CACHE_SECONDS: nonNegativeIntSchema('NAS 状态缓存时间（秒）'),
  DOCKER_ACTIONS_ENABLED: booleanStringSchema,
  DOCKER_PROTECTED_CONTAINERS: z.string().transform((val) =>
    val
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ),
  DOCKER_AUDIT_FILE: nonEmptyStringSchema('Docker 操作审计日志路径'),
  DOCKER_ACTION_TIMEOUT_MS: intInRangeSchema('Docker 操作命令超时时间（毫秒）', 5000, 300000),
} as const;

const downloadersFieldSchemas = {
  DOWNLOADERS_MOCK: booleanStringSchema,
  DOWNLOADER_CACHE_SECONDS: nonNegativeIntSchema('下载器状态缓存时间（秒）'),
  DOWNLOADER_TIMEOUT_MS: positiveIntSchema('下载器请求超时时间（毫秒）'),
  DOWNLOADER_ACTIVE_TASKS_LIMIT: intInRangeSchema('下载器活跃任务条数上限', 1, 100),
} as const;

const qbittorrentFieldSchemas = {
  QBIT_URL: httpUrlSchema,
  QBIT_USERNAME: nonEmptyStringSchema('qBittorrent 用户名'),
  QBIT_PASSWORD: nonEmptyStringSchema('qBittorrent 密码'),
  QBIT_MOCK: booleanStringSchema,
  QBIT_CACHE_SECONDS: nonNegativeIntSchema('qBittorrent 状态缓存时间（秒）'),
  QBIT_TIMEOUT_MS: positiveIntSchema('qBittorrent 请求超时时间（毫秒）'),
} as const;

const moviepilotFieldSchemas = {
  MOVIEPILOT_URL: httpUrlSchema,
  MOVIEPILOT_API_TOKEN: nonEmptyStringSchema('MoviePilot API 令牌'),
  MOVIEPILOT_MOCK: booleanStringSchema,
  MOVIEPILOT_CACHE_SECONDS: nonNegativeIntSchema('MoviePilot 状态缓存时间（秒）'),
  MOVIEPILOT_TIMEOUT_MS: positiveIntSchema('MoviePilot 请求超时时间（毫秒）'),
  MOVIEPILOT_ACTIVE_LIMIT: intInRangeSchema('MoviePilot 活跃任务条数上限', 1, 100),
} as const;

const windowsSshEnvSchema = z.object({
  WIN_SSH_HOST: nonEmptyStringSchema('Windows SSH 主机'),
  WIN_SSH_PORT: portSchema,
  WIN_SSH_USER: nonEmptyStringSchema('Windows SSH 用户名'),
  WIN_SSH_KEY_PATH: nonEmptyStringSchema('Windows SSH 私钥路径'),
});

const windowsTimeoutSchema = positiveIntSchema('Windows SSH 超时时间（毫秒）');
const windowsCacheSecondsSchema = nonNegativeIntSchema('Windows 状态缓存时间（秒）');
const devicesFileSchema = nonEmptyStringSchema('设备清单文件路径');
const deviceTimeoutSchema = positiveIntSchema('家用设备 SSH 超时时间（毫秒）');
const deviceCacheSecondsSchema = nonNegativeIntSchema('家用设备状态缓存时间（秒）');
const vpsFileSchema = nonEmptyStringSchema('VPS 清单文件路径');

function parseSingleKey<T>(
  moduleName: ConfigModuleName,
  key: string,
  schema: z.ZodType<T>,
  rawValue: string | undefined,
  defaultValue: T,
  issues: ConfigIssue[],
): { ok: true; value: T } | { ok: false } {
  if (!isEnvValueFilled(rawValue)) {
    return { ok: true, value: defaultValue };
  }
  const result = schema.safeParse(rawValue);
  if (!result.success) {
    issues.push({
      module: moduleName,
      key,
      reason: result.error.issues[0]?.message || '配置格式无效',
    });
    return { ok: false };
  }
  return { ok: true, value: result.data };
}

function parseVpsSection(
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): VpsSectionConfig | undefined {
  const readonlyRes = parseSingleKey(
    'vps',
    'VPS_READONLY',
    booleanStringSchema,
    env.VPS_READONLY,
    false,
    issues,
  );

  if (!isEnvValueFilled(env.VPS_LIST_FILE)) {
    return undefined;
  }

  const fileRes = vpsFileSchema.safeParse(env.VPS_LIST_FILE);
  if (!fileRes.success) {
    issues.push({
      module: 'vps',
      key: 'VPS_LIST_FILE',
      reason: fileRes.error.issues[0]?.message || '配置格式无效',
    });
    return undefined;
  }

  if (!readonlyRes.ok) {
    return undefined;
  }

  return {
    VPS_LIST_FILE: fileRes.data,
    VPS_READONLY: readonlyRes.value,
  };
}

function parseDevicesSection(
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): DevicesSectionConfig | undefined {
  const readonlyRes = parseSingleKey(
    'devices',
    'DEVICES_READONLY',
    booleanStringSchema,
    env.DEVICES_READONLY,
    false,
    issues,
  );
  const mockRes = parseSingleKey(
    'devices',
    'DEVICES_MOCK',
    booleanStringSchema,
    env.DEVICES_MOCK,
    false,
    issues,
  );

  // 若未填 DEVICE_* 但填了合法的 WIN_* 参数，作为兼容回退默认值
  const fallbackTimeout =
    isEnvValueFilled(env.WIN_SSH_TIMEOUT_MS) &&
    deviceTimeoutSchema.safeParse(env.WIN_SSH_TIMEOUT_MS).success
      ? deviceTimeoutSchema.parse(env.WIN_SSH_TIMEOUT_MS)
      : 8000;
  const fallbackCacheSeconds =
    isEnvValueFilled(env.WIN_CACHE_SECONDS) &&
    deviceCacheSecondsSchema.safeParse(env.WIN_CACHE_SECONDS).success
      ? deviceCacheSecondsSchema.parse(env.WIN_CACHE_SECONDS)
      : 30;

  const timeoutRes = parseSingleKey(
    'devices',
    'DEVICE_SSH_TIMEOUT_MS',
    deviceTimeoutSchema,
    env.DEVICE_SSH_TIMEOUT_MS,
    fallbackTimeout,
    issues,
  );
  const cacheRes = parseSingleKey(
    'devices',
    'DEVICE_CACHE_SECONDS',
    deviceCacheSecondsSchema,
    env.DEVICE_CACHE_SECONDS,
    fallbackCacheSeconds,
    issues,
  );

  const hasFile = isEnvValueFilled(env.DEVICES_FILE);
  const isMock = mockRes.ok && mockRes.value;

  if (!hasFile && !isMock) {
    return undefined;
  }

  let filePath: string | undefined;
  if (hasFile) {
    const fileRes = devicesFileSchema.safeParse(env.DEVICES_FILE);
    if (!fileRes.success) {
      issues.push({
        module: 'devices',
        key: 'DEVICES_FILE',
        reason: fileRes.error.issues[0]?.message || '配置格式无效',
      });
      return undefined;
    }
    filePath = fileRes.data;
  }

  if (!readonlyRes.ok || !mockRes.ok || !timeoutRes.ok || !cacheRes.ok) {
    return undefined;
  }

  return {
    ...(filePath ? { DEVICES_FILE: filePath } : {}),
    DEVICES_READONLY: readonlyRes.value,
    DEVICES_MOCK: mockRes.value,
    DEVICE_SSH_TIMEOUT_MS: timeoutRes.value,
    DEVICE_CACHE_SECONDS: cacheRes.value,
  };
}

function parseWindowsSection(
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): WindowsSectionConfig | undefined {
  const timeoutRes = parseSingleKey(
    'windows',
    'WIN_SSH_TIMEOUT_MS',
    windowsTimeoutSchema,
    env.WIN_SSH_TIMEOUT_MS,
    8000,
    issues,
  );
  const cacheRes = parseSingleKey(
    'windows',
    'WIN_CACHE_SECONDS',
    windowsCacheSecondsSchema,
    env.WIN_CACHE_SECONDS,
    30,
    issues,
  );
  const mockRes = parseSingleKey(
    'windows',
    'WIN_MOCK',
    booleanStringSchema,
    env.WIN_MOCK,
    false,
    issues,
  );

  const isMock = mockRes.ok && mockRes.value;
  const filledSshKeys = WINDOWS_SSH_REQUIRED_KEYS.filter((key) => isEnvValueFilled(env[key]));

  if (isMock) {
    const partialSsh: Partial<
      Pick<
        WindowsSectionConfig,
        'WIN_SSH_HOST' | 'WIN_SSH_PORT' | 'WIN_SSH_USER' | 'WIN_SSH_KEY_PATH'
      >
    > = {};
    for (const key of filledSshKeys) {
      const fieldSchema = windowsSshEnvSchema.shape[key];
      const fieldResult = fieldSchema.safeParse(env[key]);
      if (!fieldResult.success) {
        issues.push({
          module: 'windows',
          key,
          reason: fieldResult.error.issues[0]?.message || '配置格式无效',
        });
      } else {
        (partialSsh as Record<string, unknown>)[key] = fieldResult.data;
      }
    }

    if (!timeoutRes.ok || !cacheRes.ok) {
      return undefined;
    }

    return {
      ...partialSsh,
      WIN_SSH_TIMEOUT_MS: timeoutRes.value,
      WIN_CACHE_SECONDS: cacheRes.value,
      WIN_MOCK: true,
    };
  }

  if (filledSshKeys.length === 0) {
    return undefined;
  }

  if (filledSshKeys.length < WINDOWS_SSH_REQUIRED_KEYS.length) {
    const missingKeys = WINDOWS_SSH_REQUIRED_KEYS.filter((key) => !isEnvValueFilled(env[key]));
    for (const key of missingKeys) {
      issues.push({
        module: 'windows',
        key,
        reason: '模块已部分配置，缺少该必填项',
      });
    }
    for (const key of filledSshKeys) {
      const fieldSchema = windowsSshEnvSchema.shape[key];
      const fieldResult = fieldSchema.safeParse(env[key]);
      if (!fieldResult.success) {
        issues.push({
          module: 'windows',
          key,
          reason: fieldResult.error.issues[0]?.message || '配置格式无效',
        });
      }
    }
    return undefined;
  }

  const sshInput = pickSectionInput(env, WINDOWS_SSH_REQUIRED_KEYS);
  const sshResult = windowsSshEnvSchema.safeParse(sshInput);
  if (!sshResult.success) {
    collectZodIssues('windows', sshResult.error.issues, issues);
    return undefined;
  }

  if (!timeoutRes.ok || !cacheRes.ok || !mockRes.ok) {
    return undefined;
  }

  return {
    ...sshResult.data,
    WIN_SSH_TIMEOUT_MS: timeoutRes.value,
    WIN_CACHE_SECONDS: cacheRes.value,
    WIN_MOCK: false,
  };
}

function pickSectionInput(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const key of keys) {
    result[key] = env[key];
  }
  return result;
}

function collectZodIssues(
  moduleName: ConfigModuleName,
  zodIssues: readonly z.core.$ZodIssue[],
  issues: ConfigIssue[],
): void {
  const seenKeys = new Set<string>();
  for (const issue of zodIssues) {
    const key = typeof issue.path[0] === 'string' ? issue.path[0] : moduleName;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    issues.push({
      module: moduleName,
      key,
      reason: issue.message || '配置格式无效',
    });
  }
}

function parseNasSection(
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): NasSectionConfig | undefined {
  const anyFilled = CONFIG_MODULE_KEYS.nas.some((key) => isEnvValueFilled(env[key]));
  if (!anyFilled) {
    return undefined;
  }

  const hostRes = parseSingleKey(
    'nas',
    'NAS_SSH_HOST',
    nasFieldSchemas.NAS_SSH_HOST,
    env.NAS_SSH_HOST,
    undefined as string | undefined,
    issues,
  );
  const portRes = parseSingleKey(
    'nas',
    'NAS_SSH_PORT',
    nasFieldSchemas.NAS_SSH_PORT,
    env.NAS_SSH_PORT,
    undefined as number | undefined,
    issues,
  );
  const userRes = parseSingleKey(
    'nas',
    'NAS_SSH_USER',
    nasFieldSchemas.NAS_SSH_USER,
    env.NAS_SSH_USER,
    undefined as string | undefined,
    issues,
  );
  const keyPathRes = parseSingleKey(
    'nas',
    'NAS_SSH_KEY_PATH',
    nasFieldSchemas.NAS_SSH_KEY_PATH,
    env.NAS_SSH_KEY_PATH,
    undefined as string | undefined,
    issues,
  );
  const mockRes = parseSingleKey(
    'nas',
    'NAS_MOCK',
    nasFieldSchemas.NAS_MOCK,
    env.NAS_MOCK,
    false,
    issues,
  );
  const cacheRes = parseSingleKey(
    'nas',
    'NAS_CACHE_SECONDS',
    nasFieldSchemas.NAS_CACHE_SECONDS,
    env.NAS_CACHE_SECONDS,
    30,
    issues,
  );
  const dockerActionsRes = parseSingleKey(
    'nas',
    'DOCKER_ACTIONS_ENABLED',
    nasFieldSchemas.DOCKER_ACTIONS_ENABLED,
    env.DOCKER_ACTIONS_ENABLED,
    false,
    issues,
  );
  const dockerProtectedRes = parseSingleKey(
    'nas',
    'DOCKER_PROTECTED_CONTAINERS',
    nasFieldSchemas.DOCKER_PROTECTED_CONTAINERS,
    env.DOCKER_PROTECTED_CONTAINERS,
    ['homedash'],
    issues,
  );
  const dockerAuditRes = parseSingleKey(
    'nas',
    'DOCKER_AUDIT_FILE',
    nasFieldSchemas.DOCKER_AUDIT_FILE,
    env.DOCKER_AUDIT_FILE,
    './data/docker-audit.log',
    issues,
  );
  const dockerActionTimeoutRes = parseSingleKey(
    'nas',
    'DOCKER_ACTION_TIMEOUT_MS',
    nasFieldSchemas.DOCKER_ACTION_TIMEOUT_MS,
    env.DOCKER_ACTION_TIMEOUT_MS,
    60000,
    issues,
  );

  if (
    !hostRes.ok ||
    !portRes.ok ||
    !userRes.ok ||
    !keyPathRes.ok ||
    !mockRes.ok ||
    !cacheRes.ok ||
    !dockerActionsRes.ok ||
    !dockerProtectedRes.ok ||
    !dockerAuditRes.ok ||
    !dockerActionTimeoutRes.ok
  ) {
    return undefined;
  }

  return {
    ...(hostRes.value !== undefined ? { NAS_SSH_HOST: hostRes.value } : {}),
    ...(portRes.value !== undefined ? { NAS_SSH_PORT: portRes.value } : {}),
    ...(userRes.value !== undefined ? { NAS_SSH_USER: userRes.value } : {}),
    ...(keyPathRes.value !== undefined ? { NAS_SSH_KEY_PATH: keyPathRes.value } : {}),
    NAS_MOCK: mockRes.value,
    NAS_CACHE_SECONDS: cacheRes.value,
    DOCKER_ACTIONS_ENABLED: dockerActionsRes.value,
    DOCKER_PROTECTED_CONTAINERS: dockerProtectedRes.value,
    DOCKER_AUDIT_FILE: dockerAuditRes.value,
    DOCKER_ACTION_TIMEOUT_MS: dockerActionTimeoutRes.value,
  };
}

function parseDownloadersSection(
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): DownloadersSectionConfig | undefined {
  const anyFilled = CONFIG_MODULE_KEYS.downloaders.some((key) => isEnvValueFilled(env[key]));
  if (!anyFilled) {
    return undefined;
  }

  const fallbackCacheSeconds =
    isEnvValueFilled(env.QBIT_CACHE_SECONDS) &&
    downloadersFieldSchemas.DOWNLOADER_CACHE_SECONDS.safeParse(env.QBIT_CACHE_SECONDS).success
      ? downloadersFieldSchemas.DOWNLOADER_CACHE_SECONDS.parse(env.QBIT_CACHE_SECONDS)
      : 10;
  const fallbackTimeoutMs =
    isEnvValueFilled(env.QBIT_TIMEOUT_MS) &&
    downloadersFieldSchemas.DOWNLOADER_TIMEOUT_MS.safeParse(env.QBIT_TIMEOUT_MS).success
      ? downloadersFieldSchemas.DOWNLOADER_TIMEOUT_MS.parse(env.QBIT_TIMEOUT_MS)
      : 8000;

  const mockRes = parseSingleKey(
    'downloaders',
    'DOWNLOADERS_MOCK',
    downloadersFieldSchemas.DOWNLOADERS_MOCK,
    env.DOWNLOADERS_MOCK,
    false,
    issues,
  );
  const cacheRes = parseSingleKey(
    'downloaders',
    'DOWNLOADER_CACHE_SECONDS',
    downloadersFieldSchemas.DOWNLOADER_CACHE_SECONDS,
    env.DOWNLOADER_CACHE_SECONDS,
    fallbackCacheSeconds,
    issues,
  );
  const timeoutRes = parseSingleKey(
    'downloaders',
    'DOWNLOADER_TIMEOUT_MS',
    downloadersFieldSchemas.DOWNLOADER_TIMEOUT_MS,
    env.DOWNLOADER_TIMEOUT_MS,
    fallbackTimeoutMs,
    issues,
  );
  const activeTasksLimitRes = parseSingleKey(
    'downloaders',
    'DOWNLOADER_ACTIVE_TASKS_LIMIT',
    downloadersFieldSchemas.DOWNLOADER_ACTIVE_TASKS_LIMIT,
    env.DOWNLOADER_ACTIVE_TASKS_LIMIT,
    10,
    issues,
  );

  if (!mockRes.ok || !cacheRes.ok || !timeoutRes.ok || !activeTasksLimitRes.ok) {
    return undefined;
  }

  return {
    DOWNLOADERS_MOCK: mockRes.value,
    DOWNLOADER_CACHE_SECONDS: cacheRes.value,
    DOWNLOADER_TIMEOUT_MS: timeoutRes.value,
    DOWNLOADER_ACTIVE_TASKS_LIMIT: activeTasksLimitRes.value,
  };
}

function parseQbittorrentSection(
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): QbittorrentSectionConfig | undefined {
  const anyFilled = CONFIG_MODULE_KEYS.qbittorrent.some((key) => isEnvValueFilled(env[key]));
  if (!anyFilled) {
    return undefined;
  }

  const urlRes = parseSingleKey(
    'qbittorrent',
    'QBIT_URL',
    qbittorrentFieldSchemas.QBIT_URL,
    env.QBIT_URL,
    undefined as string | undefined,
    issues,
  );
  const usernameRes = parseSingleKey(
    'qbittorrent',
    'QBIT_USERNAME',
    qbittorrentFieldSchemas.QBIT_USERNAME,
    env.QBIT_USERNAME,
    undefined as string | undefined,
    issues,
  );
  const passwordRes = parseSingleKey(
    'qbittorrent',
    'QBIT_PASSWORD',
    qbittorrentFieldSchemas.QBIT_PASSWORD,
    env.QBIT_PASSWORD,
    undefined as string | undefined,
    issues,
  );
  const mockRes = parseSingleKey(
    'qbittorrent',
    'QBIT_MOCK',
    qbittorrentFieldSchemas.QBIT_MOCK,
    env.QBIT_MOCK,
    false,
    issues,
  );
  const cacheRes = parseSingleKey(
    'qbittorrent',
    'QBIT_CACHE_SECONDS',
    qbittorrentFieldSchemas.QBIT_CACHE_SECONDS,
    env.QBIT_CACHE_SECONDS,
    10,
    issues,
  );
  const timeoutRes = parseSingleKey(
    'qbittorrent',
    'QBIT_TIMEOUT_MS',
    qbittorrentFieldSchemas.QBIT_TIMEOUT_MS,
    env.QBIT_TIMEOUT_MS,
    8000,
    issues,
  );

  if (
    !urlRes.ok ||
    !usernameRes.ok ||
    !passwordRes.ok ||
    !mockRes.ok ||
    !cacheRes.ok ||
    !timeoutRes.ok
  ) {
    return undefined;
  }

  return {
    ...(urlRes.value !== undefined ? { QBIT_URL: urlRes.value } : {}),
    ...(usernameRes.value !== undefined ? { QBIT_USERNAME: usernameRes.value } : {}),
    ...(passwordRes.value !== undefined ? { QBIT_PASSWORD: passwordRes.value } : {}),
    QBIT_MOCK: mockRes.value,
    QBIT_CACHE_SECONDS: cacheRes.value,
    QBIT_TIMEOUT_MS: timeoutRes.value,
  };
}

function parseMoviepilotSection(
  env: Record<string, string | undefined>,
  issues: ConfigIssue[],
): MoviepilotSectionConfig | undefined {
  const anyFilled = CONFIG_MODULE_KEYS.moviepilot.some((key) => isEnvValueFilled(env[key]));
  if (!anyFilled) {
    return undefined;
  }

  const urlRes = parseSingleKey(
    'moviepilot',
    'MOVIEPILOT_URL',
    moviepilotFieldSchemas.MOVIEPILOT_URL,
    env.MOVIEPILOT_URL,
    undefined as string | undefined,
    issues,
  );
  const tokenRes = parseSingleKey(
    'moviepilot',
    'MOVIEPILOT_API_TOKEN',
    moviepilotFieldSchemas.MOVIEPILOT_API_TOKEN,
    env.MOVIEPILOT_API_TOKEN,
    undefined as string | undefined,
    issues,
  );
  const mockRes = parseSingleKey(
    'moviepilot',
    'MOVIEPILOT_MOCK',
    moviepilotFieldSchemas.MOVIEPILOT_MOCK,
    env.MOVIEPILOT_MOCK,
    false,
    issues,
  );
  const cacheRes = parseSingleKey(
    'moviepilot',
    'MOVIEPILOT_CACHE_SECONDS',
    moviepilotFieldSchemas.MOVIEPILOT_CACHE_SECONDS,
    env.MOVIEPILOT_CACHE_SECONDS,
    60,
    issues,
  );
  const timeoutRes = parseSingleKey(
    'moviepilot',
    'MOVIEPILOT_TIMEOUT_MS',
    moviepilotFieldSchemas.MOVIEPILOT_TIMEOUT_MS,
    env.MOVIEPILOT_TIMEOUT_MS,
    8000,
    issues,
  );
  const activeLimitRes = parseSingleKey(
    'moviepilot',
    'MOVIEPILOT_ACTIVE_LIMIT',
    moviepilotFieldSchemas.MOVIEPILOT_ACTIVE_LIMIT,
    env.MOVIEPILOT_ACTIVE_LIMIT,
    10,
    issues,
  );

  if (
    !urlRes.ok ||
    !tokenRes.ok ||
    !mockRes.ok ||
    !cacheRes.ok ||
    !timeoutRes.ok ||
    !activeLimitRes.ok
  ) {
    return undefined;
  }

  return {
    ...(urlRes.value !== undefined ? { MOVIEPILOT_URL: urlRes.value } : {}),
    ...(tokenRes.value !== undefined ? { MOVIEPILOT_API_TOKEN: tokenRes.value } : {}),
    MOVIEPILOT_MOCK: mockRes.value,
    MOVIEPILOT_CACHE_SECONDS: cacheRes.value,
    MOVIEPILOT_TIMEOUT_MS: timeoutRes.value,
    MOVIEPILOT_ACTIVE_LIMIT: activeLimitRes.value,
  };
}

function buildKeyPresence(env: Record<string, string | undefined>): Record<ConfigKey, boolean> {
  const presence = {} as Record<ConfigKey, boolean>;
  for (const key of ALL_CONFIG_KEYS) {
    presence[key] = isEnvValueFilled(env[key]);
  }
  return presence;
}

/**
 * 按模块分组校验并解析环境变量配置；失败时抛出仅含变量名和中文原因的 ConfigError。
 */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const issues: ConfigIssue[] = [];

  const appResult = appEnvSchema.safeParse(pickSectionInput(env, CONFIG_MODULE_KEYS.app));
  if (!appResult.success) {
    collectZodIssues('app', appResult.error.issues, issues);
  }

  const authResult = authEnvSchema.safeParse(pickSectionInput(env, CONFIG_MODULE_KEYS.auth));
  if (!authResult.success) {
    collectZodIssues('auth', authResult.error.issues, issues);
  }

  const nas = parseNasSection(env, issues);
  const downloaders = parseDownloadersSection(env, issues);
  const qbittorrent = parseQbittorrentSection(env, issues);
  const moviepilot = parseMoviepilotSection(env, issues);
  const devices = parseDevicesSection(env, issues);
  const windows = parseWindowsSection(env, issues);
  const vps = parseVpsSection(env, issues);

  if (issues.length > 0 || !appResult.success || !authResult.success) {
    throw new ConfigError(issues);
  }

  const parsedApp = appResult.data;
  const parsedAuth = authResult.data;

  const appSection: AppSectionConfig = {
    NODE_ENV: parsedApp.NODE_ENV,
    PORT: parsedApp.PORT,
    HOST: parsedApp.HOST,
    DATABASE_URL: parsedApp.DATABASE_URL,
    WEB_DIST_DIR: parsedApp.WEB_DIST_DIR
      ? path.resolve(SERVER_ROOT, parsedApp.WEB_DIST_DIR)
      : path.resolve(SERVER_ROOT, '../web/dist'),
    COOKIE_SECURE: parsedApp.COOKIE_SECURE ?? parsedApp.NODE_ENV === 'production',
    TRUST_PROXY: parsedApp.TRUST_PROXY,
    TZ_DISPLAY: parsedApp.TZ_DISPLAY,
    ...(parsedApp.INTEGRATIONS_FILE ? { INTEGRATIONS_FILE: parsedApp.INTEGRATIONS_FILE } : {}),
    ...(parsedApp.CONFIG_ENCRYPTION_KEY
      ? { CONFIG_ENCRYPTION_KEY: parsedApp.CONFIG_ENCRYPTION_KEY }
      : {}),
  };

  const authSection: AuthSectionConfig = {
    ADMIN_USERNAME: parsedAuth.ADMIN_USERNAME,
    ADMIN_PASSWORD_HASH: parsedAuth.ADMIN_PASSWORD_HASH,
    SESSION_SECRET: parsedAuth.SESSION_SECRET,
    SESSION_TTL_HOURS: parsedAuth.SESSION_TTL_HOURS,
    SESSION_TTL_SECONDS: parsedAuth.SESSION_TTL_HOURS * 3600,
    LOGIN_MAX_ATTEMPTS: parsedAuth.LOGIN_MAX_ATTEMPTS,
    LOGIN_LOCK_MINUTES: parsedAuth.LOGIN_LOCK_MINUTES,
  };

  return {
    app: appSection,
    auth: authSection,
    nas,
    downloaders,
    qbittorrent,
    moviepilot,
    devices,
    windows,
    vps,
    keyPresence: Object.freeze(buildKeyPresence(env)),
  };
}

/**
 * 加载 .env 文件并解析当前进程配置。
 */
export function loadConfig(): AppConfig {
  loadEnvFiles();
  return parseConfig(process.env);
}
