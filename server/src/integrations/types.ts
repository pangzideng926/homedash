export type IntegrationModuleName = 'nas' | 'qbittorrent' | 'moviepilot';

export type IntegrationFieldSource = 'env' | 'file' | 'unset';

export type DownloaderType = 'qbittorrent' | 'transmission';

export type DownloaderTag = 'download' | 'brush' | 'seed';

export interface EncryptedFieldValue {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export interface StoredDownloaderRecord {
  id: string;
  name: string;
  type: DownloaderType;
  url: string;
  username: string;
  password?: EncryptedFieldValue;
  tags: DownloaderTag[];
  enabled: boolean;
}

export interface IntegrationsFileData {
  nas?: {
    host?: string;
    port?: number;
    user?: string;
    keyPath?: string;
  };
  qbittorrent?: {
    url?: string;
    username?: string;
    password?: EncryptedFieldValue;
  };
  moviepilot?: {
    url?: string;
    apiToken?: EncryptedFieldValue;
  };
  downloaders?: StoredDownloaderRecord[];
  docker?: {
    protectedContainers?: string[];
  };
}

export interface PublicIntegrationField<T = string | number> {
  source: IntegrationFieldSource;
  set: boolean;
  value?: T;
}

export interface PublicSecretIntegrationField {
  source: IntegrationFieldSource;
  set: boolean;
}

export interface NasIntegrationView {
  configured: boolean;
  mock: boolean;
  fields: {
    host: PublicIntegrationField<string>;
    port: PublicIntegrationField<number>;
    user: PublicIntegrationField<string>;
    keyPath: PublicIntegrationField<string>;
  };
}

export interface QbittorrentIntegrationView {
  configured: boolean;
  mock: boolean;
  fields: {
    url: PublicIntegrationField<string>;
    username: PublicIntegrationField<string>;
    password: PublicSecretIntegrationField;
  };
}

export interface MoviepilotIntegrationView {
  configured: boolean;
  mock: boolean;
  fields: {
    url: PublicIntegrationField<string>;
    apiToken: PublicSecretIntegrationField;
  };
}

export interface IntegrationsViewResponse {
  fileConfigured: boolean;
  modules: {
    nas: NasIntegrationView;
    qbittorrent: QbittorrentIntegrationView;
    moviepilot: MoviepilotIntegrationView;
  };
  error?: string;
}

export interface ResolvedNasConfig {
  configured: boolean;
  mock: boolean;
  host?: string;
  port?: number;
  user?: string;
  keyPath?: string;
  cacheSeconds: number;
}

export interface ResolvedQbittorrentConfig {
  configured: boolean;
  mock: boolean;
  url?: string;
  username?: string;
  password?: string;
  cacheSeconds: number;
  timeoutMs: number;
}

export interface ResolvedMoviepilotConfig {
  configured: boolean;
  mock: boolean;
  url?: string;
  apiToken?: string;
  cacheSeconds: number;
  timeoutMs: number;
  activeLimit: number;
}

export interface NasTestOverride {
  host?: string | null;
  port?: number | string | null;
  user?: string | null;
  keyPath?: string | null;
}

export interface QbittorrentTestOverride {
  url?: string | null;
  username?: string | null;
  password?: string | null;
}

export interface MoviepilotTestOverride {
  url?: string | null;
  apiToken?: string | null;
}

export interface IntegrationTestResponse {
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

export type SaveIntegrationResult =
  | { ok: true; data: IntegrationsViewResponse }
  | { ok: false; status: 400 | 409 | 500; error: string; details?: string[] };

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

export interface DownloadersListResponse {
  configured: boolean;
  fileConfigured: boolean;
  mock: boolean;
  downloaders: DownloaderPublicConfig[];
  error?: string;
}

export interface ResolvedDownloaderInstance {
  id: string;
  name: string;
  type: DownloaderType;
  url: string;
  username: string;
  password?: string;
  tags: DownloaderTag[];
  enabled: boolean;
  source: 'file' | 'env' | 'mock';
  readonly: boolean;
}

export interface ResolvedDownloadersConfig {
  configured: boolean;
  mock: boolean;
  cacheSeconds: number;
  timeoutMs: number;
  activeTasksLimit: number;
  instances: ResolvedDownloaderInstance[];
}

export type SaveDownloadersResult =
  | { ok: true; data: DownloadersListResponse }
  | { ok: false; status: 400 | 409 | 500; error: string; details?: string[] };
