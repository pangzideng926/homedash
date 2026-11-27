export type IntegrationModuleName = 'nas' | 'qbittorrent' | 'moviepilot';

export type IntegrationFieldSource = 'env' | 'file' | 'unset';

export interface EncryptedFieldValue {
  v: 1;
  iv: string;
  tag: string;
  data: string;
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
