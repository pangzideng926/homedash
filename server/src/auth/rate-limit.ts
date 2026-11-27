import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

export interface RateLimitStatus {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
  remainingMinutes: number;
}

export interface LoginRateLimiter {
  check(key: string, now?: number): RateLimitStatus;
  recordFailure(key: string, now?: number): RateLimitStatus;
  reset(key: string): void;
}

export interface InMemoryLoginRateLimiterOptions {
  maxAttempts: number;
  lockMinutes: number;
  now?: () => number;
}

interface AttemptRecord {
  failures: number;
  lockedUntil?: number;
}

const MAX_TRACKED_KEYS = 1000;

/**
 * 基于内存的登录限流器：按客户端 IP 统计连续失败次数并在超出阈值后锁定。
 */
export class InMemoryLoginRateLimiter implements LoginRateLimiter {
  private readonly maxAttempts: number;
  private readonly lockDurationMs: number;
  private readonly getNow: () => number;
  private readonly records = new Map<string, AttemptRecord>();

  constructor(options: InMemoryLoginRateLimiterOptions) {
    this.maxAttempts = Math.max(1, options.maxAttempts);
    this.lockDurationMs = Math.max(1, options.lockMinutes) * 60_000;
    this.getNow = options.now ?? Date.now;
  }

  check(key: string, now = this.getNow()): RateLimitStatus {
    const record = this.records.get(key);
    if (!record) {
      return {
        allowed: true,
        remainingAttempts: this.maxAttempts,
        retryAfterSeconds: 0,
        remainingMinutes: 0,
      };
    }

    if (record.lockedUntil !== undefined) {
      if (record.lockedUntil > now) {
        return this.buildLockedStatus(record.lockedUntil - now);
      }
      this.records.delete(key);
      return {
        allowed: true,
        remainingAttempts: this.maxAttempts,
        retryAfterSeconds: 0,
        remainingMinutes: 0,
      };
    }

    return {
      allowed: true,
      remainingAttempts: Math.max(0, this.maxAttempts - record.failures),
      retryAfterSeconds: 0,
      remainingMinutes: 0,
    };
  }

  recordFailure(key: string, now = this.getNow()): RateLimitStatus {
    let record = this.records.get(key);
    if (record?.lockedUntil !== undefined) {
      if (record.lockedUntil > now) {
        return this.buildLockedStatus(record.lockedUntil - now);
      }
      this.records.delete(key);
      record = undefined;
    }

    const failures = (record?.failures ?? 0) + 1;
    if (failures >= this.maxAttempts) {
      const lockedUntil = now + this.lockDurationMs;
      this.records.set(key, { failures, lockedUntil });
      this.pruneIfNeeded(now);
      return this.buildLockedStatus(this.lockDurationMs);
    }

    this.records.set(key, { failures });
    this.pruneIfNeeded(now);
    return {
      allowed: true,
      remainingAttempts: this.maxAttempts - failures,
      retryAfterSeconds: 0,
      remainingMinutes: 0,
    };
  }

  reset(key: string): void {
    this.records.delete(key);
  }

  private buildLockedStatus(remainingMs: number): RateLimitStatus {
    const safeRemainingMs = Math.max(1, remainingMs);
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(safeRemainingMs / 1000)),
      remainingMinutes: Math.max(1, Math.ceil(safeRemainingMs / 60_000)),
    };
  }

  private pruneIfNeeded(now: number): void {
    if (this.records.size <= MAX_TRACKED_KEYS) {
      return;
    }
    for (const [entryKey, record] of this.records.entries()) {
      if (record.lockedUntil !== undefined && record.lockedUntil <= now) {
        this.records.delete(entryKey);
      }
    }
  }
}

/**
 * 解析客户端 IP：仅在 TRUST_PROXY=true 时优先读取 x-forwarded-for，否则使用连接远端地址。
 */
export function getClientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedFor = c.req.header('x-forwarded-for');
    if (forwardedFor) {
      const firstIp = forwardedFor
        .split(',')
        .map((segment) => segment.trim())
        .find((segment) => segment.length > 0);
      if (firstIp) {
        return firstIp;
      }
    }
  }

  try {
    const connInfo = getConnInfo(c);
    if (connInfo.remote.address) {
      return connInfo.remote.address;
    }
  } catch {
    // 非 Node HTTP 运行环境（如 app.request 单元测试）中无连接 socket，直接回退
  }

  return 'unknown';
}
