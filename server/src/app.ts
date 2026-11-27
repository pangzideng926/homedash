import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyPassword } from './auth/password.js';
import { getClientIp, InMemoryLoginRateLimiter, type LoginRateLimiter } from './auth/rate-limit.js';
import { createSession, deleteSession, SESSION_COOKIE_NAME } from './auth/session.js';
import { getConfigStatus, type AppConfig, type SafeLogger } from './config/index.js';
import type { AppDatabase } from './db/index.js';
import { createAuthMiddleware, type AppVariables } from './middleware/auth.js';
import { createDevicesService, type SshCommandExecutor } from './devices/index.js';
import { createDownloadersService } from './downloaders/index.js';
import {
  createIntegrationsStore,
  type MoviepilotTestOverride,
  type NasTestOverride,
  type QbittorrentTestOverride,
} from './integrations/index.js';
import {
  createMediaImageProxy,
  createMediaService,
  IMAGE_CACHE_CONTROL_HEADER,
} from './media/index.js';
import { createMoviepilotService } from './moviepilot/index.js';
import { createNasDockerService, createNasService } from './nas/index.js';
import { createQbittorrentService } from './qbittorrent/index.js';
import { readVpsList, saveVpsList } from './vps/service.js';
import type { WindowsCommandExecutor } from './windows/index.js';

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
  sshExecutor?: SshCommandExecutor;
  readPrivateKey?: (keyPath: string) => Promise<string | Buffer>;
  windowsExecutor?: WindowsCommandExecutor;
  readWindowsPrivateKey?: (keyPath: string) => Promise<string | Buffer>;
  fetchFn?: typeof fetch;
  logger?: SafeLogger;
  mediaImageCacheDir?: string | null;
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
  const devicesService = createDevicesService(config, {
    executor: options?.sshExecutor ?? options?.windowsExecutor,
    readPrivateKey: options?.readPrivateKey ?? options?.readWindowsPrivateKey,
    now: getNow,
    logger: options?.logger,
  });
  const integrationsStore = createIntegrationsStore(config, {
    logger: options?.logger,
  });
  const nasService = createNasService(config, integrationsStore, {
    executor: options?.sshExecutor ?? options?.windowsExecutor,
    readPrivateKey: options?.readPrivateKey ?? options?.readWindowsPrivateKey,
    now: getNow,
    logger: options?.logger,
  });
  const nasDockerService = createNasDockerService(config, integrationsStore, nasService, {
    executor: options?.sshExecutor ?? options?.windowsExecutor,
    readPrivateKey: options?.readPrivateKey ?? options?.readWindowsPrivateKey,
    now: getNow,
    logger: options?.logger,
  });
  const downloadersService = createDownloadersService(integrationsStore, {
    fetchFn: options?.fetchFn,
    now: getNow,
    logger: options?.logger,
  });
  const qbittorrentService = createQbittorrentService(integrationsStore, {
    fetchFn: options?.fetchFn,
    now: getNow,
    logger: options?.logger,
  });
  const moviepilotService = createMoviepilotService(integrationsStore, {
    fetchFn: options?.fetchFn,
    now: getNow,
    logger: options?.logger,
  });
  const mediaImageProxy = createMediaImageProxy(config, {
    fetchFn: options?.fetchFn,
    cacheDir: options?.mediaImageCacheDir,
    getMpBaseUrl: () => integrationsStore.resolveMoviepilotConfig().url,
    logger: options?.logger,
  });
  const mediaService = createMediaService(
    config,
    integrationsStore,
    downloadersService,
    mediaImageProxy,
    {
      fetchFn: options?.fetchFn,
      now: getNow,
      logger: options?.logger,
    },
  );

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
    return c.json(
      getConfigStatus(config, integrationsStore.getMergedKeyPresence(), {
        downloaders: integrationsStore.hasConfiguredDownloaders(),
        media:
          integrationsStore.resolveMoviepilotConfig().configured ||
          integrationsStore.hasConfiguredDownloaders(),
      }),
    );
  });

  app.get('/api/integrations', (c) => {
    return c.json(integrationsStore.getView());
  });

  app.put('/api/integrations/:module', async (c) => {
    const moduleName = c.req.param('module');
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: '请求体 JSON 格式错误' }, 400);
    }

    const result = integrationsStore.saveModule(moduleName, rawBody);
    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        },
        result.status,
      );
    }

    if (moduleName === 'nas') nasService.invalidateCache();
    if (moduleName === 'qbittorrent') {
      qbittorrentService.invalidateCache();
      downloadersService.invalidateCache();
      mediaService.invalidateCache();
    }
    if (moduleName === 'moviepilot') {
      moviepilotService.invalidateCache();
      mediaService.invalidateCache();
    }

    return c.json(result.data);
  });

  app.post('/api/integrations/:module/test', async (c) => {
    const moduleName = c.req.param('module');
    if (moduleName !== 'nas' && moduleName !== 'qbittorrent' && moduleName !== 'moviepilot') {
      return c.json({ error: '不支持的集成模块名称' }, 400);
    }

    let rawBody: unknown = {};
    const text = await c.req.text();
    if (text.trim()) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return c.json({ error: '请求体 JSON 格式错误' }, 400);
      }
      if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
        return c.json({ error: '请求体必须为 JSON 对象' }, 400);
      }
    }

    if (moduleName === 'nas') {
      return c.json(await nasService.testConnection(rawBody as NasTestOverride));
    }
    if (moduleName === 'qbittorrent') {
      return c.json(await qbittorrentService.testConnection(rawBody as QbittorrentTestOverride));
    }
    return c.json(await moviepilotService.testConnection(rawBody as MoviepilotTestOverride));
  });

  app.get('/api/nas/status', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    return c.json(await nasService.getStatus({ refresh }));
  });

  app.get('/api/nas/docker/audit', (c) => {
    const limitParam = c.req.query('limit');
    const result = nasDockerService.getAudit(limitParam);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.data);
  });

  app.get('/api/nas/docker/:name/logs', async (c) => {
    const name = c.req.param('name');
    const tailParam = c.req.query('tail');
    const result = await nasDockerService.getLogs({ name, tailRaw: tailParam });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.data);
  });

  app.post('/api/nas/docker/:name/:action', async (c) => {
    const name = c.req.param('name');
    const action = c.req.param('action');
    const result = await nasDockerService.executeAction({
      name,
      action,
      username: c.get('username'),
      clientIp: resolveClientIp(c),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.data);
  });

  app.get('/api/downloaders', (c) => {
    return c.json(integrationsStore.getDownloadersView());
  });

  app.put('/api/downloaders', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: '请求体 JSON 格式错误' }, 400);
    }

    const result = integrationsStore.saveDownloaders(rawBody);
    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        },
        result.status,
      );
    }

    downloadersService.invalidateCache();
    qbittorrentService.invalidateCache();
    mediaService.invalidateCache();
    return c.json(result.data);
  });

  app.get('/api/downloaders/summary', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    return c.json(await downloadersService.getAllSummaries({ refresh }));
  });

  app.get('/api/downloaders/:id/summary', async (c) => {
    const id = c.req.param('id');
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    const activeLimitRaw = c.req.query('activeLimit');
    let activeLimit: number | undefined;
    if (activeLimitRaw !== undefined && activeLimitRaw.trim() !== '') {
      const trimmed = activeLimitRaw.trim();
      if (!/^\d+$/.test(trimmed)) {
        return c.json({ error: 'activeLimit 参数必须是 1 到 100 之间的整数' }, 400);
      }
      const parsed = Number(trimmed);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
        return c.json({ error: 'activeLimit 参数必须是 1 到 100 之间的整数' }, 400);
      }
      activeLimit = parsed;
    }
    const result = await downloadersService.getInstanceSummary(id, { refresh, activeLimit });
    if (!result.found) {
      return c.json({ error: '未找到指定下载器实例' }, 404);
    }
    return c.json(result.data);
  });

  app.post('/api/downloaders/test', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: '请求体 JSON 格式错误' }, 400);
    }

    const result = await downloadersService.testConnection(rawBody);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.data);
  });

  // 兼容旧版 /api/qbittorrent/summary，优先读取旧配置，否则回退到第一个启用的 qBittorrent 实例
  app.get('/api/qbittorrent/summary', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    const legacyCfg = integrationsStore.resolveQbittorrentConfig();
    if (legacyCfg.configured) {
      return c.json(await qbittorrentService.getSummary({ refresh }));
    }

    const resolvedDownloaders = integrationsStore.resolveDownloadersConfig();
    const firstQb = resolvedDownloaders.instances.find(
      (item) => item.enabled && item.type === 'qbittorrent',
    );
    if (!firstQb) {
      return c.json(await qbittorrentService.getSummary({ refresh }));
    }

    const detail = await downloadersService.getInstanceSummary(firstQb.id, { refresh });
    if (!detail.found) {
      return c.json(await qbittorrentService.getSummary({ refresh }));
    }

    const s = detail.data;
    return c.json({
      configured: true,
      mock: resolvedDownloaders.mock,
      online: s.online,
      checkedAt: s.checkedAt,
      cached: s.cached,
      ...(s.errorCode ? { errorCode: s.errorCode } : {}),
      ...(s.error ? { error: s.error } : {}),
      ...(s.online
        ? {
            data: {
              version: s.version,
              transfer: {
                upSpeed: s.upSpeed,
                dlSpeed: s.dlSpeed,
                alltimeUploadBytes: s.totalUploaded ?? 0,
                alltimeDownloadBytes: s.totalDownloaded ?? 0,
                globalRatio: s.ratio ?? 0,
                totalsApproximate: Boolean(s.totalsApproximate),
              },
              counts: {
                ...s.counts,
                other: Math.max(
                  0,
                  s.counts.total -
                    (s.counts.seeding +
                      s.counts.downloading +
                      s.counts.paused +
                      s.counts.error +
                      s.counts.stalled),
                ),
              },
              byTracker: s.byTracker.map((item) => ({
                name: item.domain,
                seedingCount: item.seedingCount,
                totalCount: item.count,
                totalSizeBytes: item.size,
              })),
              byCategory: (s.byCategory ?? []).map((item) => ({
                name: item.name,
                seedingCount: item.seedingCount,
                totalCount: item.count,
                totalSizeBytes: item.size,
              })),
              problemTorrents: s.problems.map((item) => ({
                hash: item.id,
                name: item.name,
                state: item.state,
                reason: item.reason,
                sizeBytes: item.size,
                trackerDomain: item.trackerDomain,
                category: item.group,
                progress: item.progress,
              })),
              problemTorrentsTotal: s.problemsTotal,
            },
          }
        : {}),
    });
  });

  app.get('/api/moviepilot/summary', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    return c.json(await moviepilotService.getSummary({ refresh }));
  });

  app.get('/api/media/overview', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    return c.json(await mediaService.getOverview({ refresh }));
  });

  app.get('/api/media/downloads', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    return c.json(await mediaService.getDownloads({ refresh }));
  });

  app.get('/api/media/subscriptions', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    return c.json(await mediaService.getSubscriptions({ refresh }));
  });

  app.get('/api/media/image/:token', async (c) => {
    const token = c.req.param('token');
    const result = await mediaImageProxy.fetchImageByToken(token);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return new Response(new Uint8Array(result.body), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': IMAGE_CACHE_CONTROL_HEADER,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.get('/api/vps', (c) => {
    return c.json(readVpsList(config, getNow()));
  });

  app.put('/api/vps', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: '请求体 JSON 格式错误' }, 400);
    }

    const result = saveVpsList(config, rawBody, getNow());
    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        },
        result.status,
      );
    }

    return c.json(result.data);
  });

  app.get('/api/devices', (c) => {
    return c.json(devicesService.getDevices());
  });

  app.put('/api/devices', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: '请求体 JSON 格式错误' }, 400);
    }

    const result = devicesService.saveDevices(rawBody);
    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        },
        result.status,
      );
    }

    return c.json(result.data);
  });

  app.get('/api/devices/status', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    const result = await devicesService.getAllStatuses({ refresh });
    return c.json(result);
  });

  app.get('/api/devices/:id/status', async (c) => {
    const id = c.req.param('id');
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    const result = await devicesService.getDeviceStatus(id, { refresh });
    if (!result.found) {
      return c.json({ error: '未找到指定设备' }, 404);
    }
    return c.json(result.data);
  });

  app.post('/api/devices/test', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: '请求体 JSON 格式错误' }, 400);
    }

    const result = await devicesService.testConnection(rawBody);
    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        },
        result.status,
      );
    }

    return c.json(result.data);
  });

  // 兼容旧版 /api/windows/status，返回第一台启用 Windows 设备的状态
  app.get('/api/windows/status', async (c) => {
    const refreshParam = c.req.query('refresh');
    const refresh = refreshParam === '1' || refreshParam === 'true';
    const result = await devicesService.getLegacyWindowsStatus({ refresh });
    return c.json(result);
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
