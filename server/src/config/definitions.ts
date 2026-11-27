export const CONFIG_MODULE_NAMES = [
  'app',
  'auth',
  'nas',
  'downloaders',
  'qbittorrent',
  'moviepilot',
  'devices',
  'windows',
  'vps',
] as const;

export type ConfigModuleName = (typeof CONFIG_MODULE_NAMES)[number];

export const OPTIONAL_CONFIG_MODULES = [
  'nas',
  'downloaders',
  'qbittorrent',
  'moviepilot',
  'devices',
  'windows',
  'vps',
] as const;

export type OptionalConfigModuleName = (typeof OPTIONAL_CONFIG_MODULES)[number];

export const CONFIG_MODULE_LABELS: Readonly<Record<ConfigModuleName, string>> = {
  app: '应用基础',
  auth: '认证与会话',
  nas: 'NAS',
  downloaders: '下载器',
  qbittorrent: 'qBittorrent（旧版兼容）',
  moviepilot: 'MoviePilot',
  devices: '家用设备',
  windows: '家用 Windows 主机（旧版兼容）',
  vps: 'VPS',
};

export const CONFIG_MODULE_KEYS = {
  app: [
    'PORT',
    'HOST',
    'NODE_ENV',
    'DATABASE_URL',
    'WEB_DIST_DIR',
    'COOKIE_SECURE',
    'TRUST_PROXY',
    'TZ_DISPLAY',
    'INTEGRATIONS_FILE',
    'CONFIG_ENCRYPTION_KEY',
  ],
  auth: [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
    'SESSION_SECRET',
    'SESSION_TTL_HOURS',
    'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES',
  ],
  nas: [
    'NAS_SSH_HOST',
    'NAS_SSH_PORT',
    'NAS_SSH_USER',
    'NAS_SSH_KEY_PATH',
    'NAS_MOCK',
    'NAS_CACHE_SECONDS',
    'DOCKER_ACTIONS_ENABLED',
    'DOCKER_PROTECTED_CONTAINERS',
    'DOCKER_AUDIT_FILE',
    'DOCKER_ACTION_TIMEOUT_MS',
  ],
  downloaders: ['DOWNLOADERS_MOCK', 'DOWNLOADER_CACHE_SECONDS', 'DOWNLOADER_TIMEOUT_MS'],
  qbittorrent: [
    'QBIT_URL',
    'QBIT_USERNAME',
    'QBIT_PASSWORD',
    'QBIT_MOCK',
    'QBIT_CACHE_SECONDS',
    'QBIT_TIMEOUT_MS',
  ],
  moviepilot: [
    'MOVIEPILOT_URL',
    'MOVIEPILOT_API_TOKEN',
    'MOVIEPILOT_MOCK',
    'MOVIEPILOT_CACHE_SECONDS',
    'MOVIEPILOT_TIMEOUT_MS',
  ],
  devices: [
    'DEVICES_FILE',
    'DEVICES_READONLY',
    'DEVICES_MOCK',
    'DEVICE_SSH_TIMEOUT_MS',
    'DEVICE_CACHE_SECONDS',
  ],
  windows: [
    'WIN_SSH_HOST',
    'WIN_SSH_PORT',
    'WIN_SSH_USER',
    'WIN_SSH_KEY_PATH',
    'WIN_SSH_TIMEOUT_MS',
    'WIN_CACHE_SECONDS',
    'WIN_MOCK',
  ],
  vps: ['VPS_LIST_FILE', 'VPS_READONLY'],
} as const satisfies Record<ConfigModuleName, readonly string[]>;

export const NAS_REQUIRED_KEYS = [
  'NAS_SSH_HOST',
  'NAS_SSH_PORT',
  'NAS_SSH_USER',
  'NAS_SSH_KEY_PATH',
] as const satisfies readonly (typeof CONFIG_MODULE_KEYS.nas)[number][];

export const QBIT_REQUIRED_KEYS = [
  'QBIT_URL',
  'QBIT_USERNAME',
  'QBIT_PASSWORD',
] as const satisfies readonly (typeof CONFIG_MODULE_KEYS.qbittorrent)[number][];

export const MOVIEPILOT_REQUIRED_KEYS = [
  'MOVIEPILOT_URL',
  'MOVIEPILOT_API_TOKEN',
] as const satisfies readonly (typeof CONFIG_MODULE_KEYS.moviepilot)[number][];

export const WINDOWS_SSH_REQUIRED_KEYS = [
  'WIN_SSH_HOST',
  'WIN_SSH_PORT',
  'WIN_SSH_USER',
  'WIN_SSH_KEY_PATH',
] as const satisfies readonly (typeof CONFIG_MODULE_KEYS.windows)[number][];

export type ConfigKey = (typeof CONFIG_MODULE_KEYS)[ConfigModuleName][number];

export const ALL_CONFIG_KEYS: readonly ConfigKey[] = CONFIG_MODULE_NAMES.flatMap(
  (moduleName) => CONFIG_MODULE_KEYS[moduleName],
);

export const AUTH_REQUIRED_KEYS = [
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'SESSION_SECRET',
] as const satisfies readonly (typeof CONFIG_MODULE_KEYS.auth)[number][];

/**
 * 集中管理敏感配置键与匹配规则，日志与状态输出中严禁暴露对应值。
 */
export const SENSITIVE_CONFIG_KEYS = [
  'ADMIN_PASSWORD_HASH',
  'SESSION_SECRET',
  'CONFIG_ENCRYPTION_KEY',
  'NAS_SSH_KEY_PATH',
  'QBIT_PASSWORD',
  'MOVIEPILOT_API_TOKEN',
  'WIN_SSH_KEY_PATH',
] as const satisfies readonly ConfigKey[];

export const SENSITIVE_KEY_PATTERN = /(PASSWORD|HASH|SECRET|TOKEN|KEY)/i;

const SENSITIVE_KEY_SET: ReadonlySet<string> = new Set<string>(SENSITIVE_CONFIG_KEYS);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_SET.has(key) || SENSITIVE_KEY_PATTERN.test(key);
}

export interface AppSectionConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HOST: string;
  DATABASE_URL: string;
  WEB_DIST_DIR: string;
  COOKIE_SECURE: boolean;
  TRUST_PROXY: boolean;
  TZ_DISPLAY: string;
  INTEGRATIONS_FILE?: string;
  CONFIG_ENCRYPTION_KEY?: string;
}

export interface AuthSectionConfig {
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  SESSION_TTL_HOURS: number;
  SESSION_TTL_SECONDS: number;
  LOGIN_MAX_ATTEMPTS: number;
  LOGIN_LOCK_MINUTES: number;
}

export interface NasSectionConfig {
  NAS_SSH_HOST?: string;
  NAS_SSH_PORT?: number;
  NAS_SSH_USER?: string;
  NAS_SSH_KEY_PATH?: string;
  NAS_MOCK: boolean;
  NAS_CACHE_SECONDS: number;
  DOCKER_ACTIONS_ENABLED: boolean;
  DOCKER_PROTECTED_CONTAINERS: string[];
  DOCKER_AUDIT_FILE: string;
  DOCKER_ACTION_TIMEOUT_MS: number;
}

export interface DownloadersSectionConfig {
  DOWNLOADERS_MOCK: boolean;
  DOWNLOADER_CACHE_SECONDS: number;
  DOWNLOADER_TIMEOUT_MS: number;
}

export interface QbittorrentSectionConfig {
  QBIT_URL?: string;
  QBIT_USERNAME?: string;
  QBIT_PASSWORD?: string;
  QBIT_MOCK: boolean;
  QBIT_CACHE_SECONDS: number;
  QBIT_TIMEOUT_MS: number;
}

export interface MoviepilotSectionConfig {
  MOVIEPILOT_URL?: string;
  MOVIEPILOT_API_TOKEN?: string;
  MOVIEPILOT_MOCK: boolean;
  MOVIEPILOT_CACHE_SECONDS: number;
  MOVIEPILOT_TIMEOUT_MS: number;
}

export interface DevicesSectionConfig {
  DEVICES_FILE?: string;
  DEVICES_READONLY: boolean;
  DEVICES_MOCK: boolean;
  DEVICE_SSH_TIMEOUT_MS: number;
  DEVICE_CACHE_SECONDS: number;
}

export interface WindowsSectionConfig {
  WIN_SSH_HOST?: string;
  WIN_SSH_PORT?: number;
  WIN_SSH_USER?: string;
  WIN_SSH_KEY_PATH?: string;
  WIN_SSH_TIMEOUT_MS: number;
  WIN_CACHE_SECONDS: number;
  WIN_MOCK: boolean;
}

export interface VpsSectionConfig {
  VPS_LIST_FILE: string;
  VPS_READONLY: boolean;
}

export interface AppConfig {
  app: AppSectionConfig;
  auth: AuthSectionConfig;
  nas?: NasSectionConfig;
  downloaders?: DownloadersSectionConfig;
  qbittorrent?: QbittorrentSectionConfig;
  moviepilot?: MoviepilotSectionConfig;
  devices?: DevicesSectionConfig;
  windows?: WindowsSectionConfig;
  vps?: VpsSectionConfig;
  /** 仅记录环境变量键是否已填写（布尔值），绝不保存任何原始值 */
  readonly keyPresence: Readonly<Record<ConfigKey, boolean>>;
}

export type ConfigModuleStatusValue = 'configured' | 'unconfigured' | 'incomplete';
export type ConfigModuleStatusLabel = '已配置' | '未配置' | '配置不完整';

export interface ConfigModuleStatus {
  id: ConfigModuleName;
  label: string;
  status: ConfigModuleStatusValue;
  statusLabel: ConfigModuleStatusLabel;
  keys: Record<string, boolean>;
}

export interface ConfigStatusReport {
  modules: Record<ConfigModuleName, ConfigModuleStatus>;
}
