import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyPassword } from './auth/password.js';
import { getClientIp, InMemoryLoginRateLimiter, type LoginRateLimiter } from './auth/rate-limit.js';
import { createSession, deleteSession, SESSION_COOKIE_NAME } from './auth/session.js';
import { getConfigStatus, type AppConfig } from './config/index.js';
import type { AppDatabase } from './db/index.js';
import { createAuthMiddleware, type AppVariables } from './middleware/auth.js';

const loginBodySchema = z.object({
  username: z.string(),
  password: z.string(),
});

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function safeStringEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function resolveStaticFile(distDir: string, requestPath: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const normalizedRoot = path.resolve(distDir);
  const relativePath = decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(normalizedRoot, relativePath);

  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  return null;
}

export interface CreateAppOptions {
  rateLimiter?: LoginRateLimiter;
  getClientIp?: (c: Context) => string;
  now?: () => number;
}

/**
 * 创建 Hono 应用实例（与端口监听解耦，便于单元测试）。
 */
export function createApp(
  config: AppConfig,
  db: AppDatabase,
  options?: CreateAppOptions,
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  const getNow = options?.now ?? Date.now;
  const resolveClientIp =
    options?.getClientIp ?? ((c: Context) => getClientIp(c, config.app.TRUST_PROXY));
  const rateLimiter =
    options?.rateLimiter ??
    new InMemoryLoginRateLimiter({
      maxAttempts: config.auth.LOGIN_MAX_ATTEMPTS,
      lockMinutes: config.auth.LOGIN_LOCK_MINUTES,
      now: getNow,
    });

  app.use('/api/*', createAuthMiddleware(config, db, { now: getNow }));

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok' });
  });

  app.post('/api/auth/login', async (c) => {
    const now = getNow();
    const clientIp = resolveClientIp(c);
    const limitStatus = rateLimiter.check(clientIp, now);
    if (!limitStatus.allowed) {
      c.header('Retry-After', String(limitStatus.retryAfterSeconds));
      return c.json(
        { error: `登录失败次数过多，请在 ${limitStatus.remainingMinutes} 分钟后重试` },
        429,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: '请求体格式错误' }, 400);
    }

    const parsed = loginBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      rateLimiter.recordFailure(clientIp, now);
      return c.json({ error: '用户名或密码错误' }, 401);
    }

    const { username, password } = parsed.data;
    const isUsernameValid = safeStringEqual(username, config.auth.ADMIN_USERNAME);
    const isPasswordValid = await verifyPassword(password, config.auth.ADMIN_PASSWORD_HASH);

    if (!isUsernameValid || !isPasswordValid) {
      rateLimiter.recordFailure(clientIp, now);
      return c.json({ error: '用户名或密码错误' }, 401);
    }

    rateLimiter.reset(clientIp);
    const session = createSession(db, config.auth.SESSION_TTL_SECONDS, now);
    await setSignedCookie(c, SESSION_COOKIE_NAME, session.id, config.auth.SESSION_SECRET, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.app.COOKIE_SECURE,
      path: '/',
      maxAge: config.auth.SESSION_TTL_SECONDS,
    });

    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', async (c) => {
    const sessionId = await getSignedCookie(c, config.auth.SESSION_SECRET, SESSION_COOKIE_NAME);
    if (sessionId) {
      deleteSession(db, sessionId);
    }

    deleteCookie(c, SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.app.COOKIE_SECURE,
      path: '/',
    });

    return c.json({ ok: true });
  });

  app.get('/api/auth/me', (c) => {
    return c.json({
      username: c.get('username'),
      expiresAt: c.get('sessionExpiresAt').toISOString(),
    });
  });

  app.get('/api/settings/status', (c) => {
    return c.json(getConfigStatus(config));
  });

  app.all('/api/*', (c) => {
    return c.json({ error: '接口不存在' }, 404);
  });

  if (config.app.NODE_ENV === 'production') {
    const distDir = path.resolve(config.app.WEB_DIST_DIR);
    const indexHtmlPath = path.join(distDir, 'index.html');

    app.get('*', (c) => {
      const staticFile = resolveStaticFile(distDir, c.req.path);
      if (staticFile) {
        const body = fs.readFileSync(staticFile);
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': getContentType(staticFile) },
        });
      }

      if (fs.existsSync(indexHtmlPath)) {
        const html = fs.readFileSync(indexHtmlPath);
        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return c.text('前端构建产物不存在，请先执行构建', 404);
    });
  }

  return app;
}
