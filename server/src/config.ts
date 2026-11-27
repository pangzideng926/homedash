import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(currentDir, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

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

const booleanStringSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((val) => ['true', 'false', '1', '0', 'yes', 'no'].includes(val), {
    message: '布尔环境变量只接受 true/false/1/0/yes/no',
  })
  .transform((val) => val === 'true' || val === '1' || val === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  ADMIN_USERNAME: z.string().trim().min(1, '必须配置 ADMIN_USERNAME'),
  ADMIN_PASSWORD_HASH: z.string().trim().min(1, '必须配置 ADMIN_PASSWORD_HASH'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 长度至少需要 32 个字符'),
  DATABASE_URL: z.string().trim().min(1).default('file:./data/homedash.db'),
  COOKIE_SECURE: z.preprocess(
    (val) => (val === '' || val === undefined ? undefined : val),
    booleanStringSchema.optional(),
  ),
  WEB_DIST_DIR: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().min(1).optional(),
  ),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
});

export interface AppConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HOST: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  DATABASE_URL: string;
  COOKIE_SECURE: boolean;
  WEB_DIST_DIR: string;
  SESSION_TTL_SECONDS: number;
}

/**
 * 使用 zod 校验并解析环境变量配置。
 */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.parse(env);
  const webDistDir = parsed.WEB_DIST_DIR
    ? path.resolve(SERVER_ROOT, parsed.WEB_DIST_DIR)
    : path.resolve(SERVER_ROOT, '../web/dist');

  return {
    NODE_ENV: parsed.NODE_ENV,
    PORT: parsed.PORT,
    HOST: parsed.HOST,
    ADMIN_USERNAME: parsed.ADMIN_USERNAME,
    ADMIN_PASSWORD_HASH: parsed.ADMIN_PASSWORD_HASH,
    SESSION_SECRET: parsed.SESSION_SECRET,
    DATABASE_URL: parsed.DATABASE_URL,
    COOKIE_SECURE: parsed.COOKIE_SECURE ?? parsed.NODE_ENV === 'production',
    WEB_DIST_DIR: webDistDir,
    SESSION_TTL_SECONDS: parsed.SESSION_TTL_SECONDS,
  };
}

/**
 * 加载 .env 文件并解析当前进程配置。
 */
export function loadConfig(): AppConfig {
  loadEnvFiles();
  return parseConfig(process.env);
}
