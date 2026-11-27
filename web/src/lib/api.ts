export class ApiError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type UnauthorizedHandler = (error: ApiError) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * 注册全局 401 未认证处理器（由 AuthProvider 在挂载时注册）。
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipUnauthorizedHandler?: boolean;
  fallbackErrorMessage?: string;
}

function getDefaultErrorMessage(status: number, fallback?: string): string {
  if (status === 401) {
    return '未登录或会话已失效';
  }
  if (status === 403) {
    return '没有权限执行此操作';
  }
  if (status === 404) {
    return '请求的资源不存在';
  }
  if (status === 429) {
    return '请求过于频繁，请稍后重试';
  }
  if (status >= 500) {
    return '服务器内部错误，请稍后重试';
  }
  return fallback ?? '请求失败，请稍后重试';
}

function parseRetryAfterSeconds(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const parsed = Number(headerValue);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

async function extractErrorPayload(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }
    const data = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string' && data.error.trim()) {
      return data.error.trim();
    }
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === 'string' ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof ReadableStream
  );
}

/**
 * 统一请求封装：JSON 解析、中文错误规范化与全局 401 处理。
 */
export async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, headers, skipUnauthorizedHandler, fallbackErrorMessage, ...restInit } = options;

  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Accept')) {
    requestHeaders.set('Accept', 'application/json');
  }

  let serializedBody: BodyInit | undefined;
  if (body !== undefined) {
    if (isBodyInit(body)) {
      serializedBody = body;
    } else {
      if (!requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'application/json');
      }
      serializedBody = JSON.stringify(body);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...restInit,
      headers: requestHeaders,
      ...(serializedBody !== undefined ? { body: serializedBody } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError('网络请求失败，请检查网络连接', 0);
  }

  if (!response.ok) {
    const serverMessage = await extractErrorPayload(response);
    const message = serverMessage ?? getDefaultErrorMessage(response.status, fallbackErrorMessage);
    const retryAfterSeconds =
      response.status === 429
        ? parseRetryAfterSeconds(response.headers.get('Retry-After'))
        : undefined;
    const apiError = new ApiError(message, response.status, retryAfterSeconds);

    if (response.status === 401 && !skipUnauthorizedHandler && unauthorizedHandler) {
      unauthorizedHandler(apiError);
    }

    throw apiError;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('响应数据格式错误', response.status);
  }
}

export const api = {
  get<T>(url: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
    return apiRequest<T>(url, { ...options, method: 'GET' });
  },
  post<T>(
    url: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return apiRequest<T>(url, { ...options, method: 'POST', body });
  },
  put<T>(
    url: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return apiRequest<T>(url, { ...options, method: 'PUT', body });
  },
  delete<T>(url: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
    return apiRequest<T>(url, { ...options, method: 'DELETE' });
  },
};

export interface AuthUser {
  username: string;
  expiresAt?: string;
}

export type ConfigModuleStatusValue = 'configured' | 'unconfigured' | 'incomplete';

export interface ConfigModuleStatus {
  id: string;
  label: string;
  status: ConfigModuleStatusValue;
  statusLabel: string;
  keys: Record<string, boolean>;
}

export interface SettingsStatusResponse {
  modules: Record<string, ConfigModuleStatus>;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const data = await apiRequest<Partial<AuthUser>>('/api/auth/me', {
      method: 'GET',
      skipUnauthorizedHandler: true,
      fallbackErrorMessage: '获取登录状态失败',
    });

    if (!data || typeof data.username !== 'string' || !data.username) {
      return null;
    }

    return {
      username: data.username,
      ...(typeof data.expiresAt === 'string' ? { expiresAt: data.expiresAt } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function loginRequest(username: string, password: string): Promise<void> {
  try {
    await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      skipUnauthorizedHandler: true,
      fallbackErrorMessage: '登录失败，请稍后重试',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError('用户名或密码错误', 401);
    }
    throw error;
  }
}

export async function logoutRequest(): Promise<void> {
  await apiRequest('/api/auth/logout', {
    method: 'POST',
    skipUnauthorizedHandler: true,
    fallbackErrorMessage: '退出登录失败',
  });
}

export async function fetchSettingsStatus(signal?: AbortSignal): Promise<SettingsStatusResponse> {
  return apiRequest<SettingsStatusResponse>('/api/settings/status', {
    method: 'GET',
    ...(signal ? { signal } : {}),
    fallbackErrorMessage: '获取配置状态失败，请稍后重试',
  });
}

export type VpsLevel = 'expired' | 'danger' | 'warning' | 'ok';

export type VpsFileErrorCode =
  'UNCONFIGURED' | 'FILE_NOT_FOUND' | 'READ_ERROR' | 'INVALID_JSON' | 'INVALID_FORMAT';

export interface VpsServerRecord {
  id: string;
  name: string;
  provider: string | null;
  expiresAt: string;
  price: number | null;
  currency: string | null;
  renewUrl: string | null;
  note: string | null;
}

export interface VpsServerView extends VpsServerRecord {
  daysLeft: number | null;
  level: VpsLevel | null;
  error?: string;
}

export interface VpsSummary {
  total: number;
  expired: number;
  within7Days: number;
  within30Days: number;
  invalid: number;
}

export interface VpsListResponse {
  configured: boolean;
  readonly: boolean;
  timezone: string;
  servers: VpsServerView[];
  summary: VpsSummary;
  errorCode?: VpsFileErrorCode;
  error?: string;
}

export interface VpsServerInput {
  id?: string;
  name: string;
  provider?: string | null;
  expiresAt: string;
  price?: number | null;
  currency?: string | null;
  renewUrl?: string | null;
  note?: string | null;
}

export async function fetchVpsList(signal?: AbortSignal): Promise<VpsListResponse> {
  return apiRequest<VpsListResponse>('/api/vps', {
    method: 'GET',
    ...(signal ? { signal } : {}),
    fallbackErrorMessage: '获取 VPS 列表失败，请稍后重试',
  });
}

export async function saveVpsList(servers: VpsServerInput[]): Promise<VpsListResponse> {
  return apiRequest<VpsListResponse>('/api/vps', {
    method: 'PUT',
    body: { servers },
    fallbackErrorMessage: '保存 VPS 列表失败，请稍后重试',
  });
}

export type WindowsErrorCode =
  | 'UNCONFIGURED'
  | 'KEY_FILE_ERROR'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'CONNECTION_FAILED'
  | 'COMMAND_FAILED'
  | 'PARSE_FAILED';

export interface WindowsCpuInfo {
  model: string;
  loadPercent: number;
}

export interface WindowsMemoryInfo {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface WindowsDiskInfo {
  drive: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface WindowsStatusData {
  hostname: string;
  os: string;
  bootTime: string;
  uptimeSeconds: number;
  cpu: WindowsCpuInfo;
  memory: WindowsMemoryInfo;
  disks: WindowsDiskInfo[];
}

export interface WindowsStatusResponse {
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: WindowsErrorCode;
  error?: string;
  data?: WindowsStatusData;
}

export async function fetchWindowsStatus(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<WindowsStatusResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<WindowsStatusResponse>(`/api/windows/status${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取家用电脑状态失败，请稍后重试',
  });
}
