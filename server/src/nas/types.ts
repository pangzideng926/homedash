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
}

export interface NasDockerInfo {
  available: boolean;
  reason?: string;
  containers: NasDockerContainer[];
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

export type NasErrorCode =
  | 'UNCONFIGURED'
  | 'KEY_FILE_ERROR'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'CONNECTION_FAILED'
  | 'COMMAND_FAILED'
  | 'PARSE_FAILED';

export interface NasStatusResponse {
  configured: boolean;
  mock: boolean;
  online: boolean;
  checkedAt: string;
  cached: boolean;
  errorCode?: NasErrorCode;
  error?: string;
  data?: NasStatusData;
}
