import type { MoviepilotErrorCode } from './types.js';

/**
 * MoviePilot v3 只读接口白名单（依据官方仓库 jxxghp/MoviePilot v3）：
 * 严禁调用任何 /site/test/*、/download/start|stop、/transfer/now、/system/runscheduler* 等有副作用接口。
 */
export const MOVIEPILOT_ALLOWED_GET_PATHS = [
  '/api/v1/subscribe/list',
  '/api/v1/subscribe/calendar',
  '/api/v1/history/transfer',
  '/api/v1/download/',
  '/api/v1/transfer/queue/page',
  '/api/v1/dashboard/statistic',
  '/api/v1/site/',
  '/api/v1/site/statistic',
  '/api/v1/dashboard/downloader2',
] as const;

const MOVIEPILOT_ALLOWED_PATH_SET: ReadonlySet<string> = new Set<string>(
  MOVIEPILOT_ALLOWED_GET_PATHS,
);

export class MoviepilotClientError extends Error {
  readonly code: MoviepilotErrorCode;

  constructor(code: MoviepilotErrorCode, message: string) {
    super(message);
    this.name = 'MoviepilotClientError';
    this.code = code;
  }
}

/**
 * 强制校验 MoviePilot 请求方法与路径，确保仅允许白名单内的只读 GET 请求。
 */
export function assertMoviepilotRequestAllowed(method: string, pathname: string): void {
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'GET' && MOVIEPILOT_ALLOWED_PATH_SET.has(pathname)) {
    return;
  }
  throw new MoviepilotClientError(
    'API_ERROR',
    `已拦截非白名单 MoviePilot 请求：${upperMethod} ${pathname}`,
  );
}

export interface MoviepilotClientConfig {
  url: string;
  apiToken: string;
  timeoutMs: number;
}

export interface MoviepilotCalendarParams {
  start: string;
  end: string;
  page?: number;
  count?: number;
}

export interface MoviepilotClient {
  getSubscribes: (cfg: MoviepilotClientConfig) => Promise<unknown>;
  getSubscribeCalendar: (
    cfg: MoviepilotClientConfig,
    params: MoviepilotCalendarParams,
  ) => Promise<unknown>;
  getTransferHistory: (
    cfg: MoviepilotClientConfig,
    page?: number,
    count?: number,
  ) => Promise<unknown>;
  getDownloads: (cfg: MoviepilotClientConfig) => Promise<unknown>;
  getTransferQueue: (
    cfg: MoviepilotClientConfig,
    page?: number,
    count?: number,
  ) => Promise<unknown>;
  getDashboardStatistic: (cfg: MoviepilotClientConfig) => Promise<unknown>;
  getSites: (cfg: MoviepilotClientConfig) => Promise<unknown>;
  getSiteStatistics: (cfg: MoviepilotClientConfig) => Promise<unknown>;
  getDownloader2: (cfg: MoviepilotClientConfig) => Promise<unknown>;
}

function normalizeBaseUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanPath}`;
}

function classifyFetchError(error: unknown): MoviepilotClientError {
  if (error instanceof MoviepilotClientError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new MoviepilotClientError('TIMEOUT', '连接 MoviePilot 超时，请检查服务是否在线');
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout') || msg.includes('timed out')) {
      return new MoviepilotClientError('TIMEOUT', '连接 MoviePilot 超时，请检查服务是否在线');
    }
  }
  return new MoviepilotClientError('CONNECTION_FAILED', '无法连接到 MoviePilot，请检查地址与网络');
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_CALENDAR_WINDOW_DAYS = 93;

function parseDateKeyUtcMs(raw: string): number | null {
  const match = DATE_KEY_PATTERN.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt.getTime();
}

function validateCalendarParams(params: MoviepilotCalendarParams): {
  start: string;
  end: string;
  page: number;
  count: number;
} {
  const start = params.start.trim();
  const end = params.end.trim();
  const startMs = parseDateKeyUtcMs(start);
  const endMs = parseDateKeyUtcMs(end);
  if (startMs === null || endMs === null) {
    throw new MoviepilotClientError('API_ERROR', '订阅日历起止日期必须为 YYYY-MM-DD 格式');
  }
  const diffDays = Math.round((endMs - startMs) / 86_400_000);
  if (diffDays <= 0 || diffDays > MAX_CALENDAR_WINDOW_DAYS) {
    throw new MoviepilotClientError(
      'API_ERROR',
      `订阅日历时间窗口必须在 1 到 ${MAX_CALENDAR_WINDOW_DAYS} 天之间`,
    );
  }
  const page =
    typeof params.page === 'number' && Number.isFinite(params.page) && params.page >= 1
      ? Math.floor(params.page)
      : 1;
  const count =
    typeof params.count === 'number' && Number.isFinite(params.count) && params.count >= 1
      ? Math.min(200, Math.floor(params.count))
      : 200;
  return { start, end, page, count };
}

/**
 * 创建 MoviePilot v3 只读 API 客户端（使用 X-API-KEY 请求头鉴权）。
 */
export function createMoviepilotClient(fetchFn: typeof fetch = fetch): MoviepilotClient {
  async function requestGet(
    cfg: MoviepilotClientConfig,
    apiPath: string,
    query?: string,
  ): Promise<unknown> {
    assertMoviepilotRequestAllowed('GET', apiPath);
    const baseUrl = normalizeBaseUrl(cfg.url);
    const targetUrl = query ? `${baseUrl}${apiPath}?${query}` : `${baseUrl}${apiPath}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(targetUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-KEY': cfg.apiToken,
        },
        signal: controller.signal,
      });
    } catch (err) {
      throw classifyFetchError(err);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new MoviepilotClientError(
        'AUTH_FAILED',
        'MoviePilot 认证失败，请检查 API 令牌是否正确',
      );
    }

    if (!response.ok) {
      throw new MoviepilotClientError(
        'API_ERROR',
        `MoviePilot 接口 ${apiPath} 返回异常状态码 ${response.status}`,
      );
    }

    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MoviepilotClientError('PARSE_FAILED', `MoviePilot 接口 ${apiPath} 响应 JSON 无效`);
    }
  }

  return {
    getSubscribes: (cfg) => requestGet(cfg, '/api/v1/subscribe/list'),
    getSubscribeCalendar: async (cfg, params) => {
      const validated = validateCalendarParams(params);
      return requestGet(
        cfg,
        '/api/v1/subscribe/calendar',
        `start=${validated.start}&end=${validated.end}&page=${validated.page}&count=${validated.count}`,
      );
    },
    getTransferHistory: (cfg, page = 1, count = 20) =>
      requestGet(cfg, '/api/v1/history/transfer', `page=${page}&count=${count}`),
    getDownloads: (cfg) => requestGet(cfg, '/api/v1/download/'),
    getTransferQueue: (cfg, page = 1, count = 20) =>
      requestGet(cfg, '/api/v1/transfer/queue/page', `page=${page}&count=${count}`),
    getDashboardStatistic: (cfg) => requestGet(cfg, '/api/v1/dashboard/statistic'),
    getSites: (cfg) => requestGet(cfg, '/api/v1/site/'),
    getSiteStatistics: (cfg) => requestGet(cfg, '/api/v1/site/statistic'),
    getDownloader2: (cfg) => requestGet(cfg, '/api/v1/dashboard/downloader2'),
  };
}
