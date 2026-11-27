import type { QbitErrorCode } from './types.js';

export const QBIT_AUTH_LOGIN_PATH = '/api/v2/auth/login';

/**
 * qBittorrent WebUI API v2 只读路径白名单：严禁包含任何控制、修改或删除接口。
 */
export const QBIT_ALLOWED_GET_PATHS = [
  '/api/v2/app/version',
  '/api/v2/transfer/info',
  '/api/v2/sync/maindata',
  '/api/v2/torrents/info',
  '/api/v2/torrents/categories',
] as const;

const QBIT_ALLOWED_GET_PATH_SET: ReadonlySet<string> = new Set<string>(QBIT_ALLOWED_GET_PATHS);

export class QbitClientError extends Error {
  readonly code: QbitErrorCode;

  constructor(code: QbitErrorCode, message: string) {
    super(message);
    this.name = 'QbitClientError';
    this.code = code;
  }
}

/**
 * 强制校验 qBittorrent 请求方法与路径，确保只执行登录和只读 GET 查询。
 */
export function assertQbitRequestAllowed(method: string, pathname: string): void {
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'POST' && pathname === QBIT_AUTH_LOGIN_PATH) {
    return;
  }
  if (upperMethod === 'GET' && QBIT_ALLOWED_GET_PATH_SET.has(pathname)) {
    return;
  }
  throw new QbitClientError(
    'API_ERROR',
    `已拦截非白名单 qBittorrent 请求：${upperMethod} ${pathname}`,
  );
}

export interface QbitClientConfig {
  instanceId?: string;
  url: string;
  username: string;
  password: string;
  timeoutMs: number;
}

export interface QbitClient {
  getVersion: (cfg: QbitClientConfig) => Promise<string>;
  getTransferInfo: (cfg: QbitClientConfig) => Promise<Record<string, unknown>>;
  getMaindata: (cfg: QbitClientConfig) => Promise<Record<string, unknown> | null>;
  getTorrentsInfo: (cfg: QbitClientConfig) => Promise<Array<Record<string, unknown>>>;
  getCategories: (cfg: QbitClientConfig) => Promise<Record<string, unknown>>;
  clearSession: (instanceId: string) => void;
  clearSessions: () => void;
}

function normalizeBaseUrl(rawUrl: string): { baseUrl: string; origin: string; basePath: string } {
  const parsed = new URL(rawUrl);
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const baseUrl = `${parsed.origin}${cleanPath}`;
  return {
    baseUrl,
    origin: parsed.origin,
    basePath: cleanPath,
  };
}

function extractSidFromHeaders(headers: Headers): string | null {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const cookieList: string[] = [];
  if (typeof anyHeaders.getSetCookie === 'function') {
    cookieList.push(...anyHeaders.getSetCookie());
  }
  const single = headers.get('set-cookie');
  if (single) {
    cookieList.push(single);
  }

  for (const rawCookie of cookieList) {
    const match = /\bSID=([^;\s,]+)/i.exec(rawCookie);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function classifyFetchError(error: unknown): QbitClientError {
  if (error instanceof QbitClientError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new QbitClientError('TIMEOUT', '连接 qBittorrent 超时，请检查服务是否在线');
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout') || msg.includes('timed out')) {
      return new QbitClientError('TIMEOUT', '连接 qBittorrent 超时，请检查服务是否在线');
    }
  }
  return new QbitClientError('CONNECTION_FAILED', '无法连接到 qBittorrent，请检查地址与网络');
}

/**
 * 创建 qBittorrent WebUI API v2 只读客户端（支持 SID 复用与 403 自动重登一次）。
 */
export function createQbitClient(fetchFn: typeof fetch = fetch): QbitClient {
  const sidCache = new Map<string, string>();
  const inFlightLogin = new Map<string, Promise<string>>();

  function buildSessionKey(cfg: QbitClientConfig): string {
    const scope = cfg.instanceId ?? 'default';
    return `${scope}|${cfg.url.replace(/\/+$/, '')}|${cfg.username}`;
  }

  async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(url, { ...init, signal: controller.signal });
    } catch (err) {
      throw classifyFetchError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  async function performLogin(cfg: QbitClientConfig): Promise<string> {
    const sessionKey = buildSessionKey(cfg);
    const existingPromise = inFlightLogin.get(sessionKey);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      const { baseUrl, origin } = normalizeBaseUrl(cfg.url);
      assertQbitRequestAllowed('POST', QBIT_AUTH_LOGIN_PATH);

      const formBody = new URLSearchParams({
        username: cfg.username,
        password: cfg.password,
      });

      const response = await fetchWithTimeout(
        `${baseUrl}${QBIT_AUTH_LOGIN_PATH}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: baseUrl,
            Origin: origin,
          },
          body: formBody.toString(),
        },
        cfg.timeoutMs,
      );

      const bodyText = (await response.text()).trim();
      if (response.status === 403 && bodyText.toLowerCase().includes('banned')) {
        sidCache.delete(sessionKey);
        throw new QbitClientError(
          'IP_BANNED',
          '当前 IP 已被 qBittorrent 封禁，请稍后再试或在 WebUI 中解除封禁',
        );
      }

      if (response.status === 401 || response.status === 403 || bodyText === 'Fails.') {
        sidCache.delete(sessionKey);
        throw new QbitClientError('AUTH_FAILED', 'qBittorrent 认证失败，请检查用户名或密码');
      }

      if (!response.ok) {
        sidCache.delete(sessionKey);
        throw new QbitClientError(
          'API_ERROR',
          `qBittorrent 登录接口返回异常状态码 ${response.status}`,
        );
      }

      const sid = extractSidFromHeaders(response.headers);
      if (!sid) {
        throw new QbitClientError('AUTH_FAILED', 'qBittorrent 登录未返回有效会话 Cookie');
      }

      sidCache.set(sessionKey, sid);
      return sid;
    })().finally(() => {
      inFlightLogin.delete(sessionKey);
    });

    inFlightLogin.set(sessionKey, promise);
    return promise;
  }

  async function ensureSid(cfg: QbitClientConfig): Promise<string> {
    const sessionKey = buildSessionKey(cfg);
    const cached = sidCache.get(sessionKey);
    if (cached) {
      return cached;
    }
    return performLogin(cfg);
  }

  async function requestReadonly(cfg: QbitClientConfig, apiPath: string): Promise<string> {
    const { baseUrl, origin } = normalizeBaseUrl(cfg.url);
    assertQbitRequestAllowed('GET', apiPath);

    const sessionKey = buildSessionKey(cfg);
    let sid = await ensureSid(cfg);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchWithTimeout(
        `${baseUrl}${apiPath}`,
        {
          method: 'GET',
          headers: {
            Cookie: `SID=${sid}`,
            Referer: baseUrl,
            Origin: origin,
          },
        },
        cfg.timeoutMs,
      );

      if (response.status === 403 && attempt === 0) {
        sidCache.delete(sessionKey);
        sid = await performLogin(cfg);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        sidCache.delete(sessionKey);
        throw new QbitClientError('AUTH_FAILED', 'qBittorrent 会话认证失败，请检查凭据配置');
      }

      if (!response.ok) {
        throw new QbitClientError(
          'API_ERROR',
          `qBittorrent 接口 ${apiPath} 返回异常状态码 ${response.status}`,
        );
      }

      return response.text();
    }

    throw new QbitClientError('AUTH_FAILED', 'qBittorrent 会话认证失败');
  }

  async function requestJson<T>(cfg: QbitClientConfig, apiPath: string): Promise<T> {
    const text = await requestReadonly(cfg, apiPath);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new QbitClientError('PARSE_FAILED', `qBittorrent 接口 ${apiPath} 返回数据格式无效`);
    }
  }

  return {
    async getVersion(cfg: QbitClientConfig): Promise<string> {
      const text = await requestReadonly(cfg, '/api/v2/app/version');
      return text.trim() || '未知版本';
    },

    async getTransferInfo(cfg: QbitClientConfig): Promise<Record<string, unknown>> {
      const data = await requestJson<unknown>(cfg, '/api/v2/transfer/info');
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new QbitClientError('PARSE_FAILED', 'qBittorrent 传输信息格式无效');
      }
      return data as Record<string, unknown>;
    },

    async getMaindata(cfg: QbitClientConfig): Promise<Record<string, unknown> | null> {
      try {
        const data = await requestJson<unknown>(cfg, '/api/v2/sync/maindata');
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      } catch (err) {
        // 认证/封禁/超时等严重错误直接抛出；若仅 maindata 不可用则返回 null 降级由 torrents 汇总
        if (
          err instanceof QbitClientError &&
          (err.code === 'AUTH_FAILED' || err.code === 'IP_BANNED' || err.code === 'TIMEOUT')
        ) {
          throw err;
        }
        return null;
      }
    },

    async getTorrentsInfo(cfg: QbitClientConfig): Promise<Array<Record<string, unknown>>> {
      const data = await requestJson<unknown>(cfg, '/api/v2/torrents/info');
      if (!Array.isArray(data)) {
        throw new QbitClientError('PARSE_FAILED', 'qBittorrent 种子列表格式无效');
      }
      return data.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      );
    },

    async getCategories(cfg: QbitClientConfig): Promise<Record<string, unknown>> {
      try {
        const data = await requestJson<unknown>(cfg, '/api/v2/torrents/categories');
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return {};
        }
        return data as Record<string, unknown>;
      } catch {
        return {};
      }
    },

    clearSession(instanceId: string): void {
      const prefix = `${instanceId}|`;
      for (const key of sidCache.keys()) {
        if (key.startsWith(prefix)) {
          sidCache.delete(key);
        }
      }
    },

    clearSessions(): void {
      sidCache.clear();
    },
  };
}
