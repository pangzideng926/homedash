import { randomBytes } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';
import { sessions, type Session } from '../db/schema.js';

export const SESSION_COOKIE_NAME = 'homedash_session';

/**
 * 清理所有已过期会话，返回删除的记录数。
 */
export function purgeExpiredSessions(db: AppDatabase, now = Date.now()): number {
  const result = db
    .delete(sessions)
    .where(lte(sessions.expiresAt, new Date(now)))
    .run();
  return result.changes;
}

/**
 * 创建新的登录会话并写入数据库（同时清理历史过期会话）。
 */
export function createSession(db: AppDatabase, ttlSeconds: number, now = Date.now()): Session {
  purgeExpiredSessions(db, now);

  const session: Session = {
    id: randomBytes(32).toString('hex'),
    createdAt: new Date(now),
    expiresAt: new Date(now + ttlSeconds * 1000),
  };

  db.insert(sessions).values(session).run();
  return session;
}

/**
 * 查找有效会话；若会话已过期则自动清理并返回 null。
 */
export function findValidSession(
  db: AppDatabase,
  sessionId: string,
  now = Date.now(),
): Session | null {
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= now) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }

  return session;
}

/**
 * 删除指定会话。
 */
export function deleteSession(db: AppDatabase, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}
