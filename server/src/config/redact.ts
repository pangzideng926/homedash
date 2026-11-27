import { isSensitiveKey, type AppConfig } from './definitions.js';

export const REDACTED = '[REDACTED]';

const BEARER_PATTERN = /\b(Bearer\s+)[^\s,;'"`]+/gi;
const SCRYPT_HASH_PATTERN = /scrypt\$[0-9a-f]+\$[0-9a-f]+/gi;
const SESSION_COOKIE_PATTERN = /\b(homedash_session=)[^;\s]+/gi;
const INLINE_SENSITIVE_KV_PATTERN =
  /(\b[A-Z0-9_]*(?:PASSWORD|HASH|SECRET|TOKEN|KEY)[A-Z0-9_]*\b|\b(?:password|passwd|secret|token|api_key|apikey)\b)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;

function normalizeSecretValues(secretValues?: readonly string[]): string[] {
  if (!secretValues || secretValues.length === 0) {
    return [];
  }

  const unique = new Set<string>();
  for (const value of secretValues) {
    if (typeof value === 'string' && value.length > 0) {
      unique.add(value);
    }
  }

  return [...unique].sort((a, b) => b.length - a.length);
}

/**
 * 收集已解析配置中的敏感字符串值，供日志脱敏器替换使用。
 */
export function collectSecretValues(config: AppConfig): string[] {
  const candidates = [
    config.auth.ADMIN_PASSWORD_HASH,
    config.auth.SESSION_SECRET,
    config.app.CONFIG_ENCRYPTION_KEY,
    config.nas?.NAS_SSH_KEY_PATH,
    config.qbittorrent?.QBIT_PASSWORD,
    config.moviepilot?.MOVIEPILOT_API_TOKEN,
    config.windows?.WIN_SSH_KEY_PATH,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return normalizeSecretValues(candidates);
}

/**
 * 对文本日志中的显式敏感值及常见凭据模式进行脱敏。
 */
export function redactText(text: string, secretValues?: readonly string[]): string {
  let result = text;

  for (const secret of normalizeSecretValues(secretValues)) {
    if (result.includes(secret)) {
      result = result.split(secret).join(REDACTED);
    }
  }

  result = result.replace(BEARER_PATTERN, `$1${REDACTED}`);
  result = result.replace(SCRYPT_HASH_PATTERN, REDACTED);
  result = result.replace(SESSION_COOKIE_PATTERN, `$1${REDACTED}`);
  result = result.replace(INLINE_SENSITIVE_KV_PATTERN, `$1$2${REDACTED}`);

  return result;
}

function redactRecursive(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return redactText(value, secrets);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message, secrets),
      ...(value.stack ? { stack: redactText(value.stack, secrets) } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactRecursive(item, secrets, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      output[key] = REDACTED;
    } else {
      output[key] = redactRecursive(entryValue, secrets, seen);
    }
  }
  return output;
}

/**
 * 对任意日志参数（字符串、对象、数组、Error）递归执行敏感键和敏感值脱敏。
 */
export function redactValue(value: unknown, secretValues?: readonly string[]): unknown {
  const secrets = normalizeSecretValues(secretValues);
  return redactRecursive(value, secrets, new WeakSet<object>());
}

export interface SafeLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * 创建带自动脱敏能力的日志记录器。
 */
export function createSafeLogger(secretValues?: readonly string[]): SafeLogger {
  const secrets = normalizeSecretValues(secretValues);
  const sanitizeArgs = (args: unknown[]) => args.map((arg) => redactValue(arg, secrets));

  return {
    info: (...args: unknown[]) => {
      console.log(...sanitizeArgs(args));
    },
    warn: (...args: unknown[]) => {
      console.warn(...sanitizeArgs(args));
    },
    error: (...args: unknown[]) => {
      console.error(...sanitizeArgs(args));
    },
  };
}
