import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';
import { sessions, type Session } from '../db/schema.js';

export const SESSION_COOKIE_NAME = 'homedash_session';

/**
 * 创建新的登录会话并写入数据库。
 */
export function createSession(db: AppDatabase, ttlSeconds: number): Session {
  const now = Date.now();
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
export function findValidSession(db: AppDatabase, sessionId: string): Session | null {
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
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
