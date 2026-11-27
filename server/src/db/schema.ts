import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 登录会话表：保存服务端会话 ID 与过期时间。
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
