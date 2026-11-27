import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT, type AppConfig } from '../config/index.js';

export type VpsLevel = 'expired' | 'danger' | 'warning' | 'ok';

export type VpsFileErrorCode =
  'UNCONFIGURED' | 'FILE_NOT_FOUND' | 'READ_ERROR' | 'INVALID_JSON' | 'INVALID_FORMAT';

export interface VpsServerRecord {
  id: string;
  name: string;
  region: string | null;
  ip: string | null;
  monthlyTrafficGB: number | null;
  role: string | null;
  provider: string | null;
  expiresAt: string;
  price: number | null;
  currency: string | null;
  renewUrl: string | null;
  note: string | null;
}

export interface VpsServerView extends VpsServerRecord {
  daysLeft: number | null;
  level: VpsLevel | null;
  error?: string;
}

export interface VpsSummary {
  total: number;
  expired: number;
  within7Days: number;
  within30Days: number;
  invalid: number;
}

export interface VpsListResponse {
  configured: boolean;
  readonly: boolean;
  timezone: string;
  servers: VpsServerView[];
  summary: VpsSummary;
  errorCode?: VpsFileErrorCode;
  error?: string;
}

export type SaveVpsResult =
  | { ok: true; data: VpsListResponse }
  | { ok: false; status: 400 | 403 | 500; error: string; details?: string[] };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * 校验 YYYY-MM-DD 是否为真实存在的公历日期（拒绝如 2026-02-30）。
 */
export function isValidDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * 提取指定时间戳在目标 IANA 时区下的年月日。
 */
export function getDatePartsInTimeZone(
  nowMs: number,
  timeZone: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(nowMs));
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return { year, month, day };
}

/**
 * 按指定展示时区计算距离到期日（YYYY-MM-DD）的剩余天数；已过期返回负数。
 */
export function calculateDaysLeft(expiresAt: string, nowMs: number, timeZone: string): number {
  const match = DATE_PATTERN.exec(expiresAt);
  if (!match) {
    throw new Error(`无效的日期格式：${expiresAt}`);
  }
  const expYear = Number(match[1]);
  const expMonth = Number(match[2]);
  const expDay = Number(match[3]);
  const today = getDatePartsInTimeZone(nowMs, timeZone);

  const expUtcMs = Date.UTC(expYear, expMonth - 1, expDay);
  const todayUtcMs = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((expUtcMs - todayUtcMs) / MS_PER_DAY);
}

/**
 * 根据剩余天数计算告警等级。
 */
export function calculateVpsLevel(daysLeft: number): VpsLevel {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 7) return 'danger';
  if (daysLeft <= 30) return 'warning';
  return 'ok';
}

/**
 * 校验文本是否为合法的 IPv4 或 IPv6 地址。
 */
export function isValidIpAddress(value: string): boolean {
  return isIP(value) !== 0;
}

function nullableTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value as string;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const optionalNullableStringSchema = z.preprocess(
  nullableTrimmedString,
  z.string().nullable().optional(),
);

const optionalNullableIpSchema = z.preprocess(
  nullableTrimmedString,
  z
    .string()
    .refine(isValidIpAddress, {
      message: 'IP 地址格式错误，应为有效的 IPv4 或 IPv6 地址',
    })
    .nullable()
    .optional(),
);

const optionalNullableMonthlyTrafficSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return value;
  },
  z
    .number({ message: '月流量必须是数字' })
    .finite('月流量必须是有效数字')
    .min(0, '月流量不能为负数')
    .nullable()
    .optional(),
);

const optionalNullablePriceSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return value;
  },
  z
    .number({ message: '价格必须是数字' })
    .finite('价格必须是有效数字')
    .min(0, '价格不能为负数')
    .nullable()
    .optional(),
);

const optionalNullableUrlSchema = z.preprocess(
  nullableTrimmedString,
  z
    .string()
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: '续费链接必须是有效的 http:// 或 https:// 地址' },
    )
    .nullable()
    .optional(),
);

const expiresAtSchema = z
  .string({ message: '到期日期必须填写' })
  .trim()
  .refine(isValidDateString, { message: '到期日期格式错误，应为 YYYY-MM-DD' });

const vpsServerItemSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, z.string().optional()),
  name: z.string({ message: '服务器名称必须填写' }).trim().min(1, '服务器名称不能为空'),
  region: optionalNullableStringSchema,
  ip: optionalNullableIpSchema,
  monthlyTrafficGB: optionalNullableMonthlyTrafficSchema,
  role: optionalNullableStringSchema,
  provider: optionalNullableStringSchema,
  expiresAt: expiresAtSchema,
  price: optionalNullablePriceSchema,
  currency: optionalNullableStringSchema,
  renewUrl: optionalNullableUrlSchema,
  note: optionalNullableStringSchema,
});

const vpsFileRootSchema = z.object({
  servers: z.array(z.unknown(), { message: 'servers 必须是数组' }),
});

const vpsPutPayloadSchema = z.object({
  servers: z.array(vpsServerItemSchema, { message: 'servers 必须是数组' }),
});

function createEmptySummary(): VpsSummary {
  return {
    total: 0,
    expired: 0,
    within7Days: 0,
    within30Days: 0,
    invalid: 0,
  };
}

function resolveVpsFilePath(configuredPath: string): string {
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

function extractFallbackString(raw: Record<string, unknown>, key: string): string | null {
  const val = raw[key];
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}

function extractFallbackNumber(raw: Record<string, unknown>, key: string): number | null {
  const val = raw[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function evaluateServerEntry(
  rawItem: unknown,
  index: number,
  nowMs: number,
  timeZone: string,
): VpsServerView {
  const parsed = vpsServerItemSchema.safeParse(rawItem);
  if (parsed.success) {
    const item = parsed.data;
    const daysLeft = calculateDaysLeft(item.expiresAt, nowMs, timeZone);
    return {
      id: item.id ?? `vps-${index + 1}`,
      name: item.name,
      region: item.region ?? null,
      ip: item.ip ?? null,
      monthlyTrafficGB: item.monthlyTrafficGB ?? null,
      role: item.role ?? null,
      provider: item.provider ?? null,
      expiresAt: item.expiresAt,
      price: item.price ?? null,
      currency: item.currency ?? null,
      renewUrl: item.renewUrl ?? null,
      note: item.note ?? null,
      daysLeft,
      level: calculateVpsLevel(daysLeft),
    };
  }

  const rawRecord =
    typeof rawItem === 'object' && rawItem !== null && !Array.isArray(rawItem)
      ? (rawItem as Record<string, unknown>)
      : {};
  const errorMessages = parsed.error.issues.map((issue) => issue.message).filter(Boolean);

  return {
    id: extractFallbackString(rawRecord, 'id') ?? `vps-${index + 1}`,
    name: extractFallbackString(rawRecord, 'name') ?? `未命名条目 #${index + 1}`,
    region: extractFallbackString(rawRecord, 'region'),
    ip: extractFallbackString(rawRecord, 'ip'),
    monthlyTrafficGB: extractFallbackNumber(rawRecord, 'monthlyTrafficGB'),
    role: extractFallbackString(rawRecord, 'role'),
    provider: extractFallbackString(rawRecord, 'provider'),
    expiresAt: extractFallbackString(rawRecord, 'expiresAt') ?? '',
    price: extractFallbackNumber(rawRecord, 'price'),
    currency: extractFallbackString(rawRecord, 'currency'),
    renewUrl: extractFallbackString(rawRecord, 'renewUrl'),
    note: extractFallbackString(rawRecord, 'note'),
    daysLeft: null,
    level: null,
    error: errorMessages.join('；') || '条目格式错误',
  };
}

function buildSummary(servers: readonly VpsServerView[]): VpsSummary {
  const summary: VpsSummary = {
    total: servers.length,
    expired: 0,
    within7Days: 0,
    within30Days: 0,
    invalid: 0,
  };

  for (const server of servers) {
    if (server.daysLeft === null || server.level === null) {
      summary.invalid += 1;
      continue;
    }
    if (server.daysLeft < 0) {
      summary.expired += 1;
    } else {
      if (server.daysLeft <= 7) {
        summary.within7Days += 1;
      }
      if (server.daysLeft <= 30) {
        summary.within30Days += 1;
      }
    }
  }

  return summary;
}

function isValidVpsEntry(server: VpsServerView): boolean {
  return server.daysLeft !== null && server.level !== null && !server.error;
}

function compareVpsServers(a: VpsServerView, b: VpsServerView): number {
  const aValid = isValidVpsEntry(a);
  const bValid = isValidVpsEntry(b);
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  if (!aValid && !bValid) return 0;
  return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
}

function buildResponseFromRawEntries(
  rawEntries: readonly unknown[],
  readonly: boolean,
  timeZone: string,
  nowMs: number,
): VpsListResponse {
  const servers = rawEntries
    .map((item, index) => evaluateServerEntry(item, index, nowMs, timeZone))
    .sort(compareVpsServers);
  return {
    configured: true,
    readonly,
    timezone: timeZone,
    servers,
    summary: buildSummary(servers),
  };
}

/**
 * 读取并校验本地 VPS 清单文件，计算剩余天数、告警等级与汇总信息。
 */
export function readVpsList(config: AppConfig, nowMs: number = Date.now()): VpsListResponse {
  const timeZone = config.app.TZ_DISPLAY;
  if (!config.vps) {
    return {
      configured: false,
      readonly: false,
      timezone: timeZone,
      servers: [],
      summary: createEmptySummary(),
      errorCode: 'UNCONFIGURED',
      error: '尚未配置 VPS 清单文件（VPS_LIST_FILE）',
    };
  }

  const readonly = config.vps.VPS_READONLY;
  const filePath = resolveVpsFilePath(config.vps.VPS_LIST_FILE);

  let rawText: string;
  try {
    rawText = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        configured: true,
        readonly,
        timezone: timeZone,
        servers: [],
        summary: createEmptySummary(),
        errorCode: 'FILE_NOT_FOUND',
        error: 'VPS 清单文件不存在，请检查 VPS_LIST_FILE 配置',
      };
    }
    return {
      configured: true,
      readonly,
      timezone: timeZone,
      servers: [],
      summary: createEmptySummary(),
      errorCode: 'READ_ERROR',
      error: '无法读取 VPS 清单文件，请检查文件权限',
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return {
      configured: true,
      readonly,
      timezone: timeZone,
      servers: [],
      summary: createEmptySummary(),
      errorCode: 'INVALID_JSON',
      error: 'VPS 清单文件 JSON 解析失败，请检查文件格式',
    };
  }

  const rootResult = vpsFileRootSchema.safeParse(parsedJson);
  if (!rootResult.success) {
    return {
      configured: true,
      readonly,
      timezone: timeZone,
      servers: [],
      summary: createEmptySummary(),
      errorCode: 'INVALID_FORMAT',
      error: 'VPS 清单文件格式错误，根节点需包含 servers 数组',
    };
  }

  return buildResponseFromRawEntries(rootResult.data.servers, readonly, timeZone, nowMs);
}

/**
 * 校验并原子保存 VPS 清单（写入前生成 .bak 备份，写临时文件再 rename）。
 */
export function saveVpsList(
  config: AppConfig,
  rawBody: unknown,
  nowMs: number = Date.now(),
): SaveVpsResult {
  if (!config.vps) {
    return {
      ok: false,
      status: 400,
      error: '尚未配置 VPS 清单文件（VPS_LIST_FILE），无法保存',
    };
  }

  if (config.vps.VPS_READONLY) {
    return {
      ok: false,
      status: 403,
      error: '当前处于只读模式（VPS_READONLY=true），禁止修改 VPS 清单',
    };
  }

  const parsed = vpsPutPayloadSchema.safeParse(rawBody);
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

  const normalizedServers: VpsServerRecord[] = parsed.data.servers.map((item) => ({
    id: item.id ?? randomUUID(),
    name: item.name,
    region: item.region ?? null,
    ip: item.ip ?? null,
    monthlyTrafficGB: item.monthlyTrafficGB ?? null,
    role: item.role ?? null,
    provider: item.provider ?? null,
    expiresAt: item.expiresAt,
    price: item.price ?? null,
    currency: item.currency ?? null,
    renewUrl: item.renewUrl ?? null,
    note: item.note ?? null,
  }));

  const targetPath = resolveVpsFilePath(config.vps.VPS_LIST_FILE);
  const dir = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  const tempPath = path.join(
    dir,
    `.${baseName}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`,
  );

  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, `${targetPath}.bak`);
    }
    const content = `${JSON.stringify({ servers: normalizedServers }, null, 2)}\n`;
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, targetPath);
  } catch {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 忽略临时文件清理失败
      }
    }
    return {
      ok: false,
      status: 500,
      error: '写入 VPS 清单文件失败，请检查目录权限',
    };
  }

  const data = buildResponseFromRawEntries(
    normalizedServers,
    config.vps.VPS_READONLY,
    config.app.TZ_DISPLAY,
    nowMs,
  );
  return { ok: true, data };
}
