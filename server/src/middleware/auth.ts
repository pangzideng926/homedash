import type { MiddlewareHandler } from 'hono';
import { getSignedCookie } from 'hono/cookie';
import { findValidSession, SESSION_COOKIE_NAME } from '../auth/session.js';
import type { AppConfig } from '../config/index.js';
import type { AppDatabase } from '../db/index.js';

export interface AppVariables {
  username: string;
  sessionId: string;
  sessionExpiresAt: Date;
}

export interface AuthMiddlewareOptions {
  now?: () => number;
}

const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

/**
 * 统一鉴权中间件：保护除公开接口外的所有 /api/* 路由。
 */
export function createAuthMiddleware(
  config: AppConfig,
  db: AppDatabase,
  options?: AuthMiddlewareOptions,
): MiddlewareHandler<{ Variables: AppVariables }> {
  const getNow = options?.now ?? Date.now;

  return async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) {
      await next();
      return;
    }

    const sessionId = await getSignedCookie(c, config.auth.SESSION_SECRET, SESSION_COOKIE_NAME);
    if (!sessionId) {
      return c.json({ error: '未登录或会话已失效' }, 401);
    }

    const session = findValidSession(db, sessionId, getNow());
    if (!session) {
      return c.json({ error: '未登录或会话已失效' }, 401);
    }

    c.set('sessionId', session.id);
    c.set('username', config.auth.ADMIN_USERNAME);
    c.set('sessionExpiresAt', session.expiresAt);
    await next();
  };
}
