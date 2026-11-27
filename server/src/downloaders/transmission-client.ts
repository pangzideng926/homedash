import type { DownloaderErrorCode } from './types.js';

/**
 * Transmission RPC 只读方法白名单：严禁包含 torrent-start/stop/remove/set/add 等任何写操作。
 */
export const TRANSMISSION_ALLOWED_METHODS = [
  'session-get',
  'session-stats',
  'torrent-get',
] as const;

export type TransmissionAllowedMethod = (typeof TRANSMISSION_ALLOWED_METHODS)[number];

/**
 * Transmission torrent-get 允许查询的只读字段白名单。
 */
export const TRANSMISSION_TORRENT_FIELDS = [
  'id',
  'name',
  'status',
  'totalSize',
  'sizeWhenDone',
  'percentDone',
  'rateUpload',
  'rateDownload',
  'uploadedEver',
  'downloadedEver',
  'uploadRatio',
  'error',
  'errorString',
  'peersConnected',
  'trackers',
  'trackerStats',
  'labels',
  'downloadDir',
  'addedDate',
  'doneDate',
  'isStalled',
] as const;

const TRANSMISSION_ALLOWED_METHOD_SET: ReadonlySet<string> = new Set<string>(
  TRANSMISSION_ALLOWED_METHODS,
);
const TRANSMISSION_ALLOWED_FIELD_SET: ReadonlySet<string> = new Set<string>(
  TRANSMISSION_TORRENT_FIELDS,
);

export class TransmissionClientError extends Error {
  readonly code: DownloaderErrorCode;

  constructor(code: DownloaderErrorCode, message: string) {
    super(message);
    this.name = 'TransmissionClientError';
    this.code = code;
  }
}

/**
 * 强制校验 Transmission RPC 方法与 torrent-get 字段白名单。
 */
export function assertTransmissionRpcAllowed(method: string, args?: Record<string, unknown>): void {
  if (!TRANSMISSION_ALLOWED_METHOD_SET.has(method)) {
    throw new TransmissionClientError(
      'API_ERROR',
      `已拦截非白名单 Transmission RPC 方法：${method}`,
    );
  }

  if (method === 'torrent-get') {
    const fields = args?.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new TransmissionClientError('API_ERROR', 'Transmission torrent-get 必须指定白名单字段');
    }
    for (const field of fields) {
      if (typeof field !== 'string' || !TRANSMISSION_ALLOWED_FIELD_SET.has(field)) {
        throw new TransmissionClientError(
          'API_ERROR',
          `已拦截非白名单 Transmission 字段：${String(field)}`,
        );
      }
    }
  }
}

/**
 * 规范化 Transmission RPC 地址：若已包含 /transmission/rpc 则直接使用，否则自动拼接。
 */
export function normalizeTransmissionRpcUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (cleanPath.endsWith('/transmission/rpc')) {
    return `${parsed.origin}${cleanPath}`;
  }
  return `${parsed.origin}${cleanPath}/transmission/rpc`;
}

export interface TransmissionClientConfig {
  instanceId?: string;
  url: string;
  username?: string;
  password?: string;
  timeoutMs: number;
}

export interface TransmissionClient {
  getSession: (cfg: TransmissionClientConfig) => Promise<Record<string, unknown>>;
  getSessionStats: (cfg: TransmissionClientConfig) => Promise<Record<string, unknown>>;
  getTorrents: (cfg: TransmissionClientConfig) => Promise<Array<Record<string, unknown>>>;
  clearSession: (instanceId: string) => void;
  clearSessions: () => void;
}

function classifyFetchError(error: unknown): TransmissionClientError {
  if (error instanceof TransmissionClientError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new TransmissionClientError('TIMEOUT', '连接 Transmission 超时，请检查服务是否在线');
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout') || msg.includes('timed out')) {
      return new TransmissionClientError('TIMEOUT', '连接 Transmission 超时，请检查服务是否在线');
    }
  }
  return new TransmissionClientError(
    'CONNECTION_FAILED',
    '无法连接到 Transmission，请检查地址与网络',
  );
}

/**
 * 创建 Transmission RPC 只读客户端（支持 Basic 认证与 409 Session-Id 握手重试）。
 */
export function createTransmissionClient(fetchFn: typeof fetch = fetch): TransmissionClient {
  const sessionIdCache = new Map<string, string>();

  function buildSessionKey(cfg: TransmissionClientConfig, rpcUrl: string): string {
    return `${cfg.instanceId ?? 'default'}|${rpcUrl}|${cfg.username ?? ''}`;
  }

  function buildAuthHeaders(
    cfg: TransmissionClientConfig,
    sessionId?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const username = cfg.username ?? '';
    const password = cfg.password ?? '';
    if (username.length > 0 || password.length > 0) {
      const token = Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
      headers.Authorization = `Basic ${token}`;
    }
    if (sessionId) {
      headers['X-Transmission-Session-Id'] = sessionId;
    }
    return headers;
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

  async function callRpc(
    cfg: TransmissionClientConfig,
    method: TransmissionAllowedMethod,
    args?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    assertTransmissionRpcAllowed(method, args);
    const rpcUrl = normalizeTransmissionRpcUrl(cfg.url);
    const sessionKey = buildSessionKey(cfg, rpcUrl);
    const body = JSON.stringify({
      method,
      ...(args ? { arguments: args } : {}),
    });

    let sessionId = sessionIdCache.get(sessionKey);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchWithTimeout(
        rpcUrl,
        {
          method: 'POST',
          headers: buildAuthHeaders(cfg, sessionId),
          body,
        },
        cfg.timeoutMs,
      );

      if (response.status === 409 && attempt === 0) {
        const nextSessionId = response.headers.get('X-Transmission-Session-Id')?.trim();
        if (!nextSessionId) {
          sessionIdCache.delete(sessionKey);
          throw new TransmissionClientError(
            'API_ERROR',
            'Transmission 返回 409 但缺少 X-Transmission-Session-Id 响应头',
          );
        }
        sessionId = nextSessionId;
        sessionIdCache.set(sessionKey, nextSessionId);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new TransmissionClientError(
          'AUTH_FAILED',
          'Transmission 认证失败，请检查用户名或密码',
        );
      }

      if (response.status === 409) {
        sessionIdCache.delete(sessionKey);
        throw new TransmissionClientError('API_ERROR', 'Transmission 会话握手失败（409）');
      }

      if (!response.ok) {
        throw new TransmissionClientError(
          'API_ERROR',
          `Transmission RPC 返回异常状态码 ${response.status}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TransmissionClientError(
          'PARSE_FAILED',
          `Transmission ${method} 返回数据格式无效`,
        );
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TransmissionClientError('PARSE_FAILED', `Transmission ${method} 响应结构无效`);
      }

      const record = payload as { result?: unknown; arguments?: unknown };
      if (record.result !== 'success') {
        const reason =
          typeof record.result === 'string' && record.result ? record.result : '未知错误';
        throw new TransmissionClientError('API_ERROR', `Transmission RPC 返回错误：${reason}`);
      }

      if (
        !record.arguments ||
        typeof record.arguments !== 'object' ||
        Array.isArray(record.arguments)
      ) {
        return {};
      }
      return record.arguments as Record<string, unknown>;
    }

    throw new TransmissionClientError('API_ERROR', 'Transmission RPC 请求失败');
  }

  return {
    async getSession(cfg: TransmissionClientConfig): Promise<Record<string, unknown>> {
      return callRpc(cfg, 'session-get');
    },

    async getSessionStats(cfg: TransmissionClientConfig): Promise<Record<string, unknown>> {
      return callRpc(cfg, 'session-stats');
    },

    async getTorrents(cfg: TransmissionClientConfig): Promise<Array<Record<string, unknown>>> {
      const args = await callRpc(cfg, 'torrent-get', {
        fields: [...TRANSMISSION_TORRENT_FIELDS],
      });
      const torrents = args.torrents;
      if (!Array.isArray(torrents)) {
        throw new TransmissionClientError('PARSE_FAILED', 'Transmission 种子列表格式无效');
      }
      return torrents.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      );
    },

    clearSession(instanceId: string): void {
      const prefix = `${instanceId}|`;
      for (const key of sessionIdCache.keys()) {
        if (key.startsWith(prefix)) {
          sessionIdCache.delete(key);
        }
      }
    },

    clearSessions(): void {
      sessionIdCache.clear();
    },
  };
}
