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
  region: string | null;
  ip: string | null;
  monthlyTrafficGB: number | null;
  role: string | null;
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
  region?: string | null;
  ip?: string | null;
  monthlyTrafficGB?: number | null;
  role?: string | null;
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

export type DeviceOsConfig = 'auto' | 'windows' | 'macos' | 'linux';
export type TargetDeviceOs = 'windows' | 'macos' | 'linux';
export type DetectedOs = TargetDeviceOs | 'unknown';
export type DeviceSource = 'file' | 'legacy-windows' | 'mock' | 'unconfigured';

export type DeviceFileErrorCode =
  'UNCONFIGURED' | 'FILE_NOT_FOUND' | 'READ_ERROR' | 'INVALID_JSON' | 'INVALID_FORMAT';

export type DeviceErrorCode =
  | 'UNCONFIGURED'
  | 'KEY_FILE_ERROR'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'CONNECTION_FAILED'
  | 'OS_DETECT_FAILED'
  | 'COMMAND_FAILED'
  | 'PARSE_FAILED';

export interface DeviceRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  keyPath: string;
  os: DeviceOsConfig;
  enabled: boolean;
  note: string | null;
}

export interface DeviceInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  user: string;
  keyPath: string;
  os: DeviceOsConfig;
  enabled: boolean;
  note?: string | null;
}

export interface DeviceListResponse {
  configured: boolean;
  source: DeviceSource;
  readonly: boolean;
  readonlyReason?: string;
  devices: DeviceRecord[];
  errorCode?: DeviceFileErrorCode;
  error?: string;
}

export interface DeviceCpuInfo {
  model: string;
  cores: number;
  loadPercent: number;
}

export interface DeviceMemoryInfo {
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface DeviceDiskInfo {
  mount: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface DeviceStatusData {
  hostname: string;
  os: TargetDeviceOs;
  osVersion: string;
  bootTime: string;
  uptimeSeconds: number;
  cpu: DeviceCpuInfo;
  memory: DeviceMemoryInfo;
  disks: DeviceDiskInfo[];
}

export interface DeviceStatusItem {
  id: string;
  name: string;
  os: DetectedOs;
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: DeviceErrorCode;
  error?: string;
  data?: DeviceStatusData;
}

export interface DevicesStatusSummary {
  total: number;
  online: number;
  offline: number;
}

export interface DevicesStatusResponse {
  configured: boolean;
  source: DeviceSource;
  readonly: boolean;
  readonlyReason?: string;
  checkedAt: string;
  devices: DeviceStatusItem[];
  summary: DevicesStatusSummary;
  errorCode?: DeviceFileErrorCode;
  error?: string;
}

export interface DeviceTestInput {
  name?: string;
  host: string;
  port: number;
  user: string;
  keyPath: string;
  os: DeviceOsConfig;
}

export interface DeviceTestResponse {
  ok: boolean;
  os?: DetectedOs;
  durationMs: number;
  errorCode?: DeviceErrorCode;
  error?: string;
}

export async function fetchDevicesList(signal?: AbortSignal): Promise<DeviceListResponse> {
  return apiRequest<DeviceListResponse>('/api/devices', {
    method: 'GET',
    ...(signal ? { signal } : {}),
    fallbackErrorMessage: '获取家用设备列表失败，请稍后重试',
  });
}

export async function saveDevicesList(devices: DeviceInput[]): Promise<DeviceListResponse> {
  return apiRequest<DeviceListResponse>('/api/devices', {
    method: 'PUT',
    body: { devices },
    fallbackErrorMessage: '保存家用设备列表失败，请稍后重试',
  });
}

export async function fetchDevicesStatus(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<DevicesStatusResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<DevicesStatusResponse>(`/api/devices/status${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取家用设备状态失败，请稍后重试',
  });
}

export async function fetchDeviceStatus(
  id: string,
  options?: { refresh?: boolean; signal?: AbortSignal },
): Promise<DeviceStatusItem> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<DeviceStatusItem>(`/api/devices/${encodeURIComponent(id)}/status${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '刷新设备状态失败，请稍后重试',
  });
}

export async function testDeviceConnection(payload: DeviceTestInput): Promise<DeviceTestResponse> {
  return apiRequest<DeviceTestResponse>('/api/devices/test', {
    method: 'POST',
    body: payload,
    fallbackErrorMessage: '连接测试失败，请稍后重试',
  });
}

// ==================== 集成凭据配置 ====================

export type IntegrationModuleName = 'nas' | 'qbittorrent' | 'moviepilot';
export type IntegrationFieldSource = 'env' | 'file' | 'unset';

export interface PublicIntegrationField<T = string | number> {
  source: IntegrationFieldSource;
  set: boolean;
  value?: T;
}

export interface PublicSecretIntegrationField {
  source: IntegrationFieldSource;
  set: boolean;
}

export interface IntegrationsViewResponse {
  fileConfigured: boolean;
  modules: {
    nas: {
      configured: boolean;
      mock: boolean;
      fields: {
        host: PublicIntegrationField<string>;
        port: PublicIntegrationField<number>;
        user: PublicIntegrationField<string>;
        keyPath: PublicIntegrationField<string>;
      };
    };
    qbittorrent: {
      configured: boolean;
      mock: boolean;
      fields: {
        url: PublicIntegrationField<string>;
        username: PublicIntegrationField<string>;
        password: PublicSecretIntegrationField;
      };
    };
    moviepilot: {
      configured: boolean;
      mock: boolean;
      fields: {
        url: PublicIntegrationField<string>;
        apiToken: PublicSecretIntegrationField;
      };
    };
  };
  error?: string;
}

export interface IntegrationTestResponse {
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

export async function fetchIntegrations(signal?: AbortSignal): Promise<IntegrationsViewResponse> {
  return apiRequest<IntegrationsViewResponse>('/api/integrations', {
    method: 'GET',
    ...(signal ? { signal } : {}),
    fallbackErrorMessage: '获取集成配置失败，请稍后重试',
  });
}

export async function saveIntegrationModule(
  moduleName: IntegrationModuleName,
  payload: Record<string, unknown>,
): Promise<IntegrationsViewResponse> {
  return apiRequest<IntegrationsViewResponse>(`/api/integrations/${moduleName}`, {
    method: 'PUT',
    body: payload,
    fallbackErrorMessage: '保存集成配置失败，请稍后重试',
  });
}

export async function testIntegrationModule(
  moduleName: IntegrationModuleName,
  payload: Record<string, unknown>,
): Promise<IntegrationTestResponse> {
  return apiRequest<IntegrationTestResponse>(`/api/integrations/${moduleName}/test`, {
    method: 'POST',
    body: payload,
    fallbackErrorMessage: '连接测试失败，请稍后重试',
  });
}

// ==================== NAS 状态 ====================

export type NasTemperatureCategory = 'cpu' | 'nvme' | 'memory' | 'motherboard' | 'disk' | 'other';

export interface NasTemperatureGroup {
  category: NasTemperatureCategory;
  label: string;
  maxTempC: number;
  sensors: Array<{ name: string; tempC: number }>;
}

export interface NasSmartDiskTemp {
  device: string;
  model?: string;
  tempC: number;
}

export interface NasSmartInfo {
  available: boolean;
  reason?: string;
  disks: NasSmartDiskTemp[];
}

export interface NasRaidArray {
  name: string;
  status: string;
  level: string;
  members: string[];
  stateFlags: string;
  activeDevices: number;
  totalDevices: number;
  healthy: boolean;
  statusLabel: '正常' | '降级';
}

export interface NasVolumeInfo {
  mount: string;
  device: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  isVolume: boolean;
}

export interface NasDockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  runningFor: string;
  ports: string;
  cpuPercent?: string;
  memUsage?: string;
  memPercent?: string;
  protected?: boolean;
}

export interface NasDockerInfo {
  available: boolean;
  reason?: string;
  actionsEnabled?: boolean;
  protectedContainers?: string[];
  containers: NasDockerContainer[];
}

export type DockerAction = 'start' | 'stop' | 'restart';

export interface DockerActionResponse {
  ok: boolean;
  container: string;
  action: DockerAction;
  message: string;
  durationMs: number;
}

export interface DockerLogsResponse {
  container: string;
  tail: number;
  logs: string;
  fetchedAt: string;
}

export type DockerAuditResult = 'success' | 'rejected' | 'failed';

export interface DockerAuditEntry {
  timestamp: string;
  username: string;
  clientIp: string;
  container: string;
  action: string;
  result: DockerAuditResult;
  durationMs: number;
  error?: string;
}

export interface DockerAuditResponse {
  entries: DockerAuditEntry[];
  total: number;
}

export interface NasStatusData {
  hostname: string;
  osVersion: string;
  uptimeSeconds: number;
  bootTime: string;
  loadAvg: [number, number, number];
  cpu: {
    model: string;
    cores: number;
    loadPercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usedPercent: number;
  };
  temperatures: NasTemperatureGroup[];
  maxTemperatureC: number | null;
  smart: NasSmartInfo;
  raids: NasRaidArray[];
  volumes: NasVolumeInfo[];
  docker: NasDockerInfo;
}

export interface NasStatusResponse {
  configured: boolean;
  mock: boolean;
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: string;
  error?: string;
  data?: NasStatusData;
}

export async function fetchNasStatus(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<NasStatusResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<NasStatusResponse>(`/api/nas/status${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取 NAS 状态失败，请稍后重试',
  });
}

export async function executeNasDockerAction(
  name: string,
  action: DockerAction,
): Promise<DockerActionResponse> {
  try {
    return await apiRequest<DockerActionResponse>(
      `/api/nas/docker/${encodeURIComponent(name)}/${action}`,
      {
        method: 'POST',
        fallbackErrorMessage: '执行容器操作失败，请稍后重试',
      },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 504) {
      throw new ApiError(
        error.message && error.message !== '服务器内部错误，请稍后重试'
          ? error.message
          : '操作已发出但等待超时，请稍后刷新查看容器状态',
        504,
      );
    }
    throw error;
  }
}

export async function fetchNasDockerLogs(
  name: string,
  options?: { tail?: number; signal?: AbortSignal },
): Promise<DockerLogsResponse> {
  const tail = options?.tail ?? 200;
  return apiRequest<DockerLogsResponse>(
    `/api/nas/docker/${encodeURIComponent(name)}/logs?tail=${tail}`,
    {
      method: 'GET',
      ...(options?.signal ? { signal: options.signal } : {}),
      fallbackErrorMessage: '获取容器日志失败，请稍后重试',
    },
  );
}

export async function fetchNasDockerAudit(options?: {
  limit?: number;
  signal?: AbortSignal;
}): Promise<DockerAuditResponse> {
  const limit = options?.limit ?? 20;
  return apiRequest<DockerAuditResponse>(`/api/nas/docker/audit?limit=${limit}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取 Docker 操作审计记录失败，请稍后重试',
  });
}

// ==================== 多实例下载器（qBittorrent + Transmission） ====================

export type DownloaderType = 'qbittorrent' | 'transmission';
export type DownloaderTag = 'download' | 'brush' | 'seed';

export interface DownloaderPublicConfig {
  id: string;
  name: string;
  type: DownloaderType;
  url: string;
  username: string;
  passwordSet: boolean;
  tags: DownloaderTag[];
  enabled: boolean;
  source: 'file' | 'env' | 'mock';
  readonly: boolean;
  readonlyReason?: string;
}

export interface DownloaderInput {
  id?: string;
  name: string;
  type: DownloaderType;
  url: string;
  username: string;
  password?: string | null;
  tags: DownloaderTag[];
  enabled: boolean;
}

export interface DownloadersListResponse {
  configured: boolean;
  fileConfigured: boolean;
  mock: boolean;
  downloaders: DownloaderPublicConfig[];
  error?: string;
}

export interface DownloaderStateCounts {
  seeding: number;
  downloading: number;
  paused: number;
  error: number;
  stalled: number;
  total: number;
}

export interface DownloaderTrackerStat {
  domain: string;
  count: number;
  seedingCount: number;
  size: number;
}

export interface DownloaderGroupStat {
  name: string;
  count: number;
  seedingCount: number;
  size: number;
}

export interface DownloaderProblemTorrent {
  id: string;
  name: string;
  state: string;
  reason: string;
  size: number;
  trackerDomain: string;
  group: string;
  progress: number;
}

export type DownloaderActiveTaskState =
  '下载中' | '做种中' | '等待' | '校验中' | '已暂停' | '出错' | '卡住' | '元数据';

export interface DownloaderActiveTask {
  name: string;
  state: DownloaderActiveTaskState;
  progress: number;
  dlSpeed: number;
  upSpeed: number;
  eta: number | null;
  size: number;
  ratio: number;
  category?: string;
  label?: string;
}

export interface DownloaderInstanceSummary {
  id: string;
  name: string;
  type: DownloaderType;
  tags: DownloaderTag[];
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: string;
  error?: string;
  version: string;
  upSpeed: number;
  dlSpeed: number;
  totalUploaded?: number;
  totalDownloaded?: number;
  ratio?: number;
  totalsApproximate?: boolean;
  counts: DownloaderStateCounts;
  totalSize: number;
  byTracker: DownloaderTrackerStat[];
  byCategory?: DownloaderGroupStat[];
  byLabel?: DownloaderGroupStat[];
  problems: DownloaderProblemTorrent[];
  problemsTotal: number;
  activeTasks: DownloaderActiveTask[];
  activeTotal: number;
}

export interface DownloadersSummaryTotals {
  totalInstances: number;
  onlineInstances: number;
  offlineInstances: number;
  upSpeed: number;
  dlSpeed: number;
  totalSize: number;
  counts: DownloaderStateCounts;
}

export interface DownloadersSummaryResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  instances: DownloaderInstanceSummary[];
  totals: DownloadersSummaryTotals;
}

export interface DownloaderTestInput {
  id?: string;
  type: DownloaderType;
  url: string;
  username: string;
  password?: string;
}

export interface DownloaderTestResponse {
  ok: boolean;
  type: DownloaderType;
  version?: string;
  durationMs: number;
  detail?: string;
  error?: string;
}

export async function fetchDownloaders(signal?: AbortSignal): Promise<DownloadersListResponse> {
  return apiRequest<DownloadersListResponse>('/api/downloaders', {
    method: 'GET',
    ...(signal ? { signal } : {}),
    fallbackErrorMessage: '获取下载器配置列表失败，请稍后重试',
  });
}

export async function saveDownloaders(
  downloaders: DownloaderInput[],
): Promise<DownloadersListResponse> {
  return apiRequest<DownloadersListResponse>('/api/downloaders', {
    method: 'PUT',
    body: { downloaders },
    fallbackErrorMessage: '保存下载器配置失败，请稍后重试',
  });
}

export async function fetchDownloadersSummary(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<DownloadersSummaryResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<DownloadersSummaryResponse>(`/api/downloaders/summary${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取下载器汇总状态失败，请稍后重试',
  });
}

export async function fetchDownloaderDetail(
  id: string,
  options?: { refresh?: boolean; activeLimit?: number; signal?: AbortSignal },
): Promise<DownloaderInstanceSummary> {
  const params = new URLSearchParams();
  if (options?.refresh) {
    params.set('refresh', '1');
  }
  if (options?.activeLimit !== undefined) {
    params.set('activeLimit', String(options.activeLimit));
  }
  const qs = params.toString();
  const query = qs ? `?${qs}` : '';
  return apiRequest<DownloaderInstanceSummary>(
    `/api/downloaders/${encodeURIComponent(id)}/summary${query}`,
    {
      method: 'GET',
      ...(options?.signal ? { signal: options.signal } : {}),
      fallbackErrorMessage: '获取下载器详情失败，请稍后重试',
    },
  );
}

export async function testDownloaderConnection(
  payload: DownloaderTestInput,
): Promise<DownloaderTestResponse> {
  return apiRequest<DownloaderTestResponse>('/api/downloaders/test', {
    method: 'POST',
    body: payload,
    fallbackErrorMessage: '下载器连接测试失败，请稍后重试',
  });
}

// ==================== qBittorrent 摘要 ====================

export interface QbitStateCounts {
  seeding: number;
  downloading: number;
  paused: number;
  error: number;
  stalled: number;
  other: number;
  total: number;
}

export interface QbitGroupStat {
  name: string;
  seedingCount: number;
  totalCount: number;
  totalSizeBytes: number;
}

export interface QbitProblemTorrent {
  hash: string;
  name: string;
  state: string;
  reason: string;
  sizeBytes: number;
  trackerDomain: string;
  category: string;
  progress: number;
}

export interface QbitSummaryData {
  version: string;
  transfer: {
    upSpeed: number;
    dlSpeed: number;
    alltimeUploadBytes: number;
    alltimeDownloadBytes: number;
    globalRatio: number;
    totalsApproximate: boolean;
  };
  counts: QbitStateCounts;
  byTracker: QbitGroupStat[];
  byCategory: QbitGroupStat[];
  problemTorrents: QbitProblemTorrent[];
  problemTorrentsTotal: number;
}

export interface QbitSummaryResponse {
  configured: boolean;
  mock: boolean;
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: string;
  error?: string;
  data?: QbitSummaryData;
}

export async function fetchQbitSummary(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<QbitSummaryResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<QbitSummaryResponse>(`/api/qbittorrent/summary${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取 qBittorrent 摘要失败，请稍后重试',
  });
}

// ==================== MoviePilot 摘要 ====================

export interface MoviepilotSubscribeItem {
  id: number | string;
  name: string;
  year: string;
  type: string;
  season: number | null;
  state: string;
  totalEpisode: number | null;
  lackEpisode: number | null;
  lastUpdate: string;
}

export interface MoviepilotTransferItem {
  title: string;
  year: string;
  type: string;
  seasons: string;
  episodes: string;
  status: boolean;
  errmsg: string;
  date: string;
  category: string;
}

export interface MoviepilotDownloadItem {
  title: string;
  name: string;
  siteName: string;
  size: number;
  progress: number;
  state: string;
  dlSpeed: number;
  upSpeed: number;
  leftTime: string;
  downloader: string;
}

export interface MoviepilotActiveDownloadItem {
  hash: string;
  title: string;
  name: string;
  year: string;
  seasonEpisode: string;
  downloader: string;
  size: number;
  progress: number;
  state: string;
  dlSpeedText: string;
  upSpeedText: string;
  category: string;
  siteName: string;
  leftTime: string;
}

export interface MoviepilotTransferQueueItem {
  title: string;
  year: string;
  season: string;
  taskCount: number;
  stateCounts: Record<string, number>;
  sampleFiles: string[];
}

export interface MoviepilotTransferQueueSummary {
  available: boolean;
  reason?: string;
  items: MoviepilotTransferQueueItem[];
  total: number;
}

export interface MoviepilotSiteStatus {
  id: number | string;
  name: string;
  domain: string;
  isActive: boolean;
  priority: number | null;
  successCount: number;
  failCount: number;
  avgSeconds: number | null;
  lastState: 'success' | 'fail' | 'unknown';
  lastModDate: string;
}

export interface MoviepilotDownloaderStats {
  downloadSpeed: number;
  uploadSpeed: number;
  downloadSize: number;
  uploadSize: number;
  freeSpace: number;
}

export interface MoviepilotSummaryData {
  subscribes: MoviepilotSubscribeItem[];
  transfers: MoviepilotTransferItem[];
  transferTotal: number;
  downloads: MoviepilotDownloadItem[];
  activeDownloads: MoviepilotActiveDownloadItem[];
  activeDownloadsTotal: number;
  transferQueue: MoviepilotTransferQueueSummary;
  transferQueueTotal: number;
  sites: MoviepilotSiteStatus[];
  downloader: MoviepilotDownloaderStats | null;
}

export interface MoviepilotSummaryResponse {
  configured: boolean;
  mock: boolean;
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: string;
  error?: string;
  data?: MoviepilotSummaryData;
}

export async function fetchMoviepilotSummary(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<MoviepilotSummaryResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<MoviepilotSummaryResponse>(`/api/moviepilot/summary${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取 MoviePilot 摘要失败，请稍后重试',
  });
}

// ==================== 影视模块 V1 ====================

export interface MediaOverviewLibraryStats {
  movieCount: number;
  tvCount: number;
  episodeCount: number;
}

export interface MediaOverviewStats {
  downloading: number;
  pendingTransfer: number | null;
  todayImported: number;
  todayImportedApproximate: boolean;
  seeding: number | null;
  seedUploadSpeed: number | null;
  seedTotalUploaded: number | null;
  library: MediaOverviewLibraryStats | null;
}

export interface MediaRecentTransferCard {
  title: string;
  year: string;
  type: string;
  season: string;
  episodes: string;
  episodeCount: number | null;
  date: string;
  importedAt: string;
  posterUrl: string | null;
}

export interface MediaOverviewResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  cached: boolean;
  warnings: string[];
  stats: MediaOverviewStats;
  recent: MediaRecentTransferCard[];
}

export interface MediaDownloadTaskItem {
  hash: string;
  displayName: string;
  torrentName: string;
  year: string;
  seasonEpisode: string;
  posterUrl: string | null;
  progress: number;
  dlSpeed: number | null;
  upSpeed: number | null;
  dlSpeedText: string | null;
  upSpeedText: string | null;
  eta: number | null;
  leftTime: string | null;
  size: number;
  state: string;
  instanceName: string;
  site: string;
  matched: boolean;
}

export interface MediaDownloadsResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  cached: boolean;
  warnings: string[];
  items: MediaDownloadTaskItem[];
}

export interface MediaSubscriptionNextAir {
  date: string;
  episodeNumber: number | null;
  name: string;
}

export interface MediaSubscriptionItem {
  id: number | string;
  name: string;
  year: string;
  type: string;
  season: number | null;
  posterUrl: string | null;
  state: string;
  totalEpisode: number | null;
  startEpisode: number | null;
  completedEpisode: number | null;
  lackEpisode: number | null;
  downloadedEpisodes: number[];
  latestEpisode: number | null;
  missingEpisodes: number[];
  missingInferred: boolean;
  nextAir: MediaSubscriptionNextAir | null;
  hasAired: boolean | null;
  lastUpdate: string;
}

export interface MediaSubscriptionsResponse {
  configured: boolean;
  mock: boolean;
  checkedAt: string;
  cached: boolean;
  calendarAvailable: boolean;
  warnings: string[];
  items: MediaSubscriptionItem[];
}

export async function fetchMediaOverview(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<MediaOverviewResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<MediaOverviewResponse>(`/api/media/overview${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取影视总览失败，请稍后重试',
  });
}

export async function fetchMediaDownloads(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<MediaDownloadsResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<MediaDownloadsResponse>(`/api/media/downloads${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取正在下载任务失败，请稍后重试',
  });
}

export async function fetchMediaSubscriptions(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<MediaSubscriptionsResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<MediaSubscriptionsResponse>(`/api/media/subscriptions${query}`, {
    method: 'GET',
    ...(options?.signal ? { signal: options.signal } : {}),
    fallbackErrorMessage: '获取订阅追剧列表失败，请稍后重试',
  });
}
