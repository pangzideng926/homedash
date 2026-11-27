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

export interface DeviceListResponse {
  configured: boolean;
  source: DeviceSource;
  readonly: boolean;
  readonlyReason?: string;
  devices: DeviceRecord[];
  errorCode?: DeviceFileErrorCode;
  error?: string;
}

export type SaveDevicesResult =
  | { ok: true; data: DeviceListResponse }
  | { ok: false; status: 400 | 403 | 500; error: string; details?: string[] };

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
  port?: number;
  user: string;
  keyPath: string;
  os?: DeviceOsConfig;
}

export interface DeviceTestResponse {
  ok: boolean;
  os?: DetectedOs;
  durationMs: number;
  errorCode?: DeviceErrorCode;
  error?: string;
}
