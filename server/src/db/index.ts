import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { SERVER_ROOT } from '../config/index.js';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseConnection {
  db: AppDatabase;
  sqlite: Database.Database;
  close: () => void;
}

/**
 * 将 DATABASE_URL 转换为 better-sqlite3 可用的路径（支持 :memory: 和 file: 前缀）。
 */
export function resolveSqlitePath(databaseUrl: string): string {
  const trimmed = databaseUrl.trim();
  if (trimmed === ':memory:' || trimmed === 'file::memory:') {
    return ':memory:';
  }

  const rawPath = trimmed.startsWith('file:') ? trimmed.slice('file:'.length) : trimmed;
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

/**
 * 初始化 SQLite 数据库连接，自动创建数据目录并执行 Drizzle 迁移。
 */
export function createDatabase(
  databaseUrl: string,
  options?: { migrationsFolder?: string },
): DatabaseConnection {
  const sqlitePath = resolveSqlitePath(databaseUrl);

  if (sqlitePath !== ':memory:') {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  }

  const sqlite = new Database(sqlitePath);
  if (sqlitePath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }

  const db = drizzle(sqlite, { schema });
  const migrationsFolder = options?.migrationsFolder ?? path.resolve(SERVER_ROOT, 'drizzle');
  migrate(db, { migrationsFolder });

  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}
