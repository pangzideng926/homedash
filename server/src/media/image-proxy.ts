import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, SafeLogger } from '../config/index.js';
import { resolveRepoRelativePath } from '../devices/store.js';

export const IMAGE_PROXY_HKDF_INFO = 'homedash-media-image-v1';
export const DEFAULT_IMAGE_HOST_RULES = ['image.tmdb.org', '*.doubanio.com'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_FETCH_TIMEOUT_MS = 8000;
export const MAX_IMAGE_REDIRECTS = 2;
export const IMAGE_CACHE_CONTROL_HEADER = 'private, max-age=86400';

const DEFAULT_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface CachedImageEntry {
  contentType: string;
  body: Buffer;
}

export type VerifyImageTokenResult =
  { ok: true; url: string } | { ok: false; status: 400 | 403; error: string };

export type FetchProxiedImageResult =
  | {
      ok: true;
      contentType: string;
      body: Buffer;
      cacheHit: 'memory' | 'disk' | 'miss';
    }
  | {
      ok: false;
      status: 400 | 403 | 413 | 415 | 502 | 504;
      error: string;
    };

export interface CreateMediaImageProxyOptions {
  fetchFn?: typeof fetch;
  cacheDir?: string | null;
  maxMemoryEntries?: number;
  mpBaseUrl?: string;
  getMpBaseUrl?: () => string | undefined;
  logger?: SafeLogger;
}

export interface MediaImageProxy {
  toProxyUrl: (rawUrl: unknown, mpBaseUrl?: string) => string | null;
  createTokenForUrl: (rawUrl: unknown, mpBaseUrl?: string) => string | null;
  signRawUrlForTest: (rawUrl: string) => string;
  verifyToken: (token: string, mpBaseUrl?: string) => VerifyImageTokenResult;
  fetchImageByToken: (token: string, mpBaseUrl?: string) => Promise<FetchProxiedImageResult>;
  clearMemoryCache: () => void;
}

function deriveImageSigningKey(sessionSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(sessionSecret, 'utf-8'),
      Buffer.alloc(0),
      Buffer.from(IMAGE_PROXY_HKDF_INFO, 'utf-8'),
      32,
    ),
  );
}

/**
 * 判断主机名是否命中允许列表（支持 `*.domain.com` 泛域名匹配）。
 */
export function isAllowedImageHost(hostname: string, extraRules: readonly string[] = []): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;

  const allRules = [...DEFAULT_IMAGE_HOST_RULES, ...extraRules];
  for (const rawRule of allRules) {
    const rule = rawRule.trim().toLowerCase();
    if (!rule) continue;
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1); // ".doubanio.com"
      if (host.endsWith(suffix) && host.length > suffix.length) {
        return true;
      }
    } else if (host === rule) {
      return true;
    }
  }
  return false;
}

function isDoubanHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === 'doubanio.com' || host.endsWith('.doubanio.com');
}

function parseOriginSafe(rawUrl: string | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  try {
    return new URL(rawUrl).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 校验并规范化外部海报 URL：
 * - 丢弃相对路径、非 https 协议、携带凭据的 URL；
 * - 丢弃指向 MoviePilot 自身或 `/api/v1/system/img` 等内部路径的 URL；
 * - 校验主机名是否在白名单中；
 * - 将 TMDB `/t/p/original/` 改写为 `/t/p/w342/` 节省带宽。
 */
export function normalizeAllowedImageUrl(
  rawUrl: unknown,
  options?: { extraHosts?: readonly string[]; mpBaseUrl?: string },
): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || !trimmed.toLowerCase().startsWith('https://')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return null;
  }

  const mpOrigin = parseOriginSafe(options?.mpBaseUrl);
  if (mpOrigin && parsed.origin.toLowerCase() === mpOrigin) {
    return null;
  }

  if (parsed.pathname.toLowerCase().includes('/api/v1/system/img')) {
    return null;
  }

  if (!isAllowedImageHost(parsed.hostname, options?.extraHosts)) {
    return null;
  }

  if (
    parsed.hostname.toLowerCase() === 'image.tmdb.org' &&
    parsed.pathname.startsWith('/t/p/original/')
  ) {
    parsed.pathname = `/t/p/w342/${parsed.pathname.slice('/t/p/original/'.length)}`;
  }

  return parsed.toString();
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function parseImageContentType(rawHeader: string | null): string | null {
  if (!rawHeader) return null;
  const baseType = rawHeader.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!baseType.startsWith('image/')) {
    return null;
  }
  return baseType;
}

async function readResponseWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; body: Buffer } | { ok: false; tooLarge: true }> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      return { ok: false, tooLarge: true };
    }
  }

  if (!response.body) {
    const arrBuf = await response.arrayBuffer();
    if (arrBuf.byteLength > maxBytes) {
      return { ok: false, tooLarge: true };
    }
    return { ok: true, body: Buffer.from(arrBuf) };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: true, body: Buffer.concat(chunks) };
}

function writeDiskCacheAtomic(cacheDir: string, hashKey: string, entry: CachedImageEntry): void {
  const dataPath = path.join(cacheDir, hashKey);
  const metaPath = path.join(cacheDir, `${hashKey}.meta`);
  const suffix = `${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
  const tempDataPath = path.join(cacheDir, `.${hashKey}.${suffix}`);
  const tempMetaPath = path.join(cacheDir, `.${hashKey}.meta.${suffix}`);

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(tempDataPath, entry.body);
    fs.writeFileSync(tempMetaPath, JSON.stringify({ contentType: entry.contentType }), 'utf-8');
    fs.renameSync(tempDataPath, dataPath);
    fs.renameSync(tempMetaPath, metaPath);
  } catch {
    for (const p of [tempDataPath, tempMetaPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // 忽略临时文件清理失败
      }
    }
  }
}

function readDiskCache(cacheDir: string, hashKey: string): CachedImageEntry | null {
  const dataPath = path.join(cacheDir, hashKey);
  const metaPath = path.join(cacheDir, `${hashKey}.meta`);
  try {
    if (!fs.existsSync(dataPath) || !fs.existsSync(metaPath)) {
      return null;
    }
    const metaRaw = fs.readFileSync(metaPath, 'utf-8');
    const meta = JSON.parse(metaRaw) as { contentType?: unknown };
    const contentType =
      typeof meta.contentType === 'string' ? parseImageContentType(meta.contentType) : null;
    if (!contentType) {
      return null;
    }
    const body = fs.readFileSync(dataPath);
    if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    return { contentType, body };
  } catch {
    return null;
  }
}

/**
 * 创建海报安全代理（HMAC-SHA256 截断 16 字节签名 + 白名单域名校验 + 重定向检查 + LRU 与磁盘缓存）。
 */
export function createMediaImageProxy(
  config: AppConfig,
  options?: CreateMediaImageProxyOptions,
): MediaImageProxy {
  const fetchFn = options?.fetchFn ?? fetch;
  const signingKey = deriveImageSigningKey(config.auth.SESSION_SECRET);
  const extraHosts = config.media?.MEDIA_IMAGE_HOSTS ?? [];
  const maxMemoryEntries = options?.maxMemoryEntries ?? config.media?.MEDIA_IMAGE_CACHE_MAX ?? 200;
  const logger = options?.logger;

  let diskCacheDir: string | null = null;
  if (options?.cacheDir === null) {
    diskCacheDir = null;
  } else if (typeof options?.cacheDir === 'string' && options.cacheDir.trim()) {
    diskCacheDir = resolveRepoRelativePath(options.cacheDir.trim());
  } else if (config.media?.MEDIA_IMAGE_CACHE_DIR) {
    diskCacheDir = resolveRepoRelativePath(config.media.MEDIA_IMAGE_CACHE_DIR);
  } else if (config.app.NODE_ENV !== 'test') {
    diskCacheDir = resolveRepoRelativePath('./data/image-cache');
  }

  const memoryLru = new Map<string, CachedImageEntry>();

  function getMemoryEntry(key: string): CachedImageEntry | null {
    if (maxMemoryEntries <= 0) return null;
    const hit = memoryLru.get(key);
    if (!hit) return null;
    memoryLru.delete(key);
    memoryLru.set(key, hit);
    return hit;
  }

  function setMemoryEntry(key: string, entry: CachedImageEntry): void {
    if (maxMemoryEntries <= 0) return;
    if (memoryLru.has(key)) {
      memoryLru.delete(key);
    }
    memoryLru.set(key, entry);
    while (memoryLru.size > maxMemoryEntries) {
      const oldestKey = memoryLru.keys().next().value;
      if (oldestKey === undefined) break;
      memoryLru.delete(oldestKey);
    }
  }

  function resolveMpBaseUrl(override?: string): string | undefined {
    return override ?? options?.getMpBaseUrl?.() ?? options?.mpBaseUrl;
  }

  function computeSignature(targetUrl: string): Buffer {
    return createHmac('sha256', signingKey).update(targetUrl, 'utf-8').digest().subarray(0, 16);
  }

  function signToken(targetUrl: string): string {
    const encodedUrl = Buffer.from(targetUrl, 'utf-8').toString('base64url');
    const sig = computeSignature(targetUrl).toString('base64url');
    return `${encodedUrl}.${sig}`;
  }

  function verifyToken(token: string, mpBaseUrl?: string): VerifyImageTokenResult {
    if (!token || typeof token !== 'string' || /[\s/]/.test(token)) {
      return { ok: false, status: 403, error: '图片签名格式无效' };
    }
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, status: 403, error: '图片签名格式无效' };
    }

    let decodedUrl: string;
    let providedSig: Buffer;
    try {
      decodedUrl = Buffer.from(parts[0], 'base64url').toString('utf-8');
      providedSig = Buffer.from(parts[1], 'base64url');
    } catch {
      return { ok: false, status: 403, error: '图片签名编码无效' };
    }

    if (!decodedUrl || providedSig.length !== 16) {
      return { ok: false, status: 403, error: '图片签名无效' };
    }

    const expectedSig = computeSignature(decodedUrl);
    if (!timingSafeEqual(providedSig, expectedSig)) {
      return { ok: false, status: 403, error: '图片签名校验失败' };
    }

    const normalizedUrl = normalizeAllowedImageUrl(decodedUrl, {
      extraHosts,
      mpBaseUrl: resolveMpBaseUrl(mpBaseUrl),
    });
    if (!normalizedUrl) {
      return { ok: false, status: 403, error: '图片来源不在允许的白名单内' };
    }

    return { ok: true, url: normalizedUrl };
  }

  async function fetchWithValidatedRedirects(
    initialUrl: string,
    mpBaseUrl?: string,
  ): Promise<
    | { ok: true; contentType: string; body: Buffer }
    | { ok: false; status: 403 | 413 | 415 | 502 | 504; error: string }
  > {
    let currentUrl = initialUrl;
    const effectiveMpBaseUrl = resolveMpBaseUrl(mpBaseUrl);

    for (let redirectCount = 0; redirectCount <= MAX_IMAGE_REDIRECTS; redirectCount += 1) {
      const parsedCurrent = new URL(currentUrl);
      const headers: Record<string, string> = {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': DEFAULT_BROWSER_USER_AGENT,
      };
      if (isDoubanHost(parsedCurrent.hostname)) {
        headers.Referer = 'https://movie.douban.com/';
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchFn(currentUrl, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { ok: false, status: 504, error: '获取海报图片超时' };
        }
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.toLowerCase().includes('timeout'))
        ) {
          return { ok: false, status: 504, error: '获取海报图片超时' };
        }
        return { ok: false, status: 502, error: '获取海报图片失败' };
      } finally {
        clearTimeout(timer);
      }

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }
        if (!location) {
          return { ok: false, status: 502, error: '图片服务重定向响应缺少目标地址' };
        }
        if (redirectCount >= MAX_IMAGE_REDIRECTS) {
          return { ok: false, status: 502, error: '图片重定向次数过多' };
        }

        let resolvedTarget: string;
        try {
          resolvedTarget = new URL(location, currentUrl).toString();
        } catch {
          return { ok: false, status: 403, error: '图片重定向目标地址无效' };
        }

        const validatedTarget = normalizeAllowedImageUrl(resolvedTarget, {
          extraHosts,
          mpBaseUrl: effectiveMpBaseUrl,
        });
        if (!validatedTarget) {
          return { ok: false, status: 403, error: '禁止重定向到非白名单图片主机' };
        }
        currentUrl = validatedTarget;
        continue;
      }

      if (!response.ok) {
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }
        return { ok: false, status: 502, error: `图片源返回异常状态码 ${response.status}` };
      }

      const contentType = parseImageContentType(response.headers.get('content-type'));
      if (!contentType) {
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }
        return { ok: false, status: 415, error: '仅允许返回 image/* 图片内容' };
      }

      const bodyResult = await readResponseWithLimit(response, MAX_IMAGE_BYTES);
      if (!bodyResult.ok) {
        return { ok: false, status: 413, error: '图片大小超出 5MB 上限' };
      }

      return { ok: true, contentType, body: bodyResult.body };
    }

    return { ok: false, status: 502, error: '图片重定向次数过多' };
  }

  return {
    createTokenForUrl(rawUrl: unknown, mpBaseUrl?: string): string | null {
      const normalized = normalizeAllowedImageUrl(rawUrl, {
        extraHosts,
        mpBaseUrl: resolveMpBaseUrl(mpBaseUrl),
      });
      if (!normalized) return null;
      return signToken(normalized);
    },

    toProxyUrl(rawUrl: unknown, mpBaseUrl?: string): string | null {
      const token = this.createTokenForUrl(rawUrl, mpBaseUrl);
      return token ? `/api/media/image/${token}` : null;
    },

    signRawUrlForTest(rawUrl: string): string {
      return signToken(rawUrl);
    },

    verifyToken,

    async fetchImageByToken(token: string, mpBaseUrl?: string): Promise<FetchProxiedImageResult> {
      const verified = verifyToken(token, mpBaseUrl);
      if (!verified.ok) {
        return verified;
      }

      const targetUrl = verified.url;
      const cacheKey = createHash('sha256').update(targetUrl, 'utf-8').digest('hex');

      const memHit = getMemoryEntry(cacheKey);
      if (memHit) {
        return {
          ok: true,
          contentType: memHit.contentType,
          body: memHit.body,
          cacheHit: 'memory',
        };
      }

      if (diskCacheDir) {
        const diskHit = readDiskCache(diskCacheDir, cacheKey);
        if (diskHit) {
          setMemoryEntry(cacheKey, diskHit);
          return {
            ok: true,
            contentType: diskHit.contentType,
            body: diskHit.body,
            cacheHit: 'disk',
          };
        }
      }

      const fetched = await fetchWithValidatedRedirects(targetUrl, mpBaseUrl);
      if (!fetched.ok) {
        logger?.warn(`海报代理获取失败（${fetched.status}）：${fetched.error}`);
        return fetched;
      }

      const entry: CachedImageEntry = {
        contentType: fetched.contentType,
        body: fetched.body,
      };
      setMemoryEntry(cacheKey, entry);
      if (diskCacheDir) {
        writeDiskCacheAtomic(diskCacheDir, cacheKey, entry);
      }

      return {
        ok: true,
        contentType: entry.contentType,
        body: entry.body,
        cacheHit: 'miss',
      };
    },

    clearMemoryCache(): void {
      memoryLru.clear();
    },
  };
}
