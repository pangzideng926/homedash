import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  clampSshStatusCacheSeconds,
  DEFAULT_SSH_STATUS_CACHE_SECONDS,
  type AppConfig,
  type ConfigKey,
  type SafeLogger,
} from '../config/index.js';
import { resolveRepoRelativePath } from '../devices/store.js';
import { decryptSecret, deriveIntegrationKey, encryptSecret } from './crypto.js';
import type {
  DownloaderPublicConfig,
  DownloadersListResponse,
  DownloaderTag,
  DownloaderType,
  EncryptedFieldValue,
  IntegrationFieldSource,
  IntegrationModuleName,
  IntegrationsFileData,
  IntegrationsViewResponse,
  MoviepilotTestOverride,
  NasTestOverride,
  PublicIntegrationField,
  PublicSecretIntegrationField,
  QbittorrentTestOverride,
  ResolvedDownloaderInstance,
  ResolvedDownloadersConfig,
  ResolvedMoviepilotConfig,
  ResolvedNasConfig,
  ResolvedQbittorrentConfig,
  SaveDownloadersResult,
  SaveIntegrationResult,
  StoredDownloaderRecord,
} from './types.js';

const DOWNLOADER_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const DOWNLOADER_TAGS = ['download', 'brush', 'seed'] as const;

const encryptedFieldSchema = z.object({
  v: z.literal(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  data: z.string().min(1),
});

const fileNasSchema = z
  .object({
    host: z.string().trim().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().trim().min(1).optional(),
    keyPath: z.string().trim().min(1).optional(),
  })
  .optional();

const fileQbittorrentSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    username: z.string().trim().min(1).optional(),
    password: encryptedFieldSchema.optional(),
  })
  .optional();

const fileMoviepilotSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    apiToken: encryptedFieldSchema.optional(),
  })
  .optional();

const fileDownloaderSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.enum(['qbittorrent', 'transmission']),
  url: z.string().trim().min(1),
  username: z.string().default(''),
  password: encryptedFieldSchema.optional(),
  tags: z.array(z.enum(DOWNLOADER_TAGS)).default([]),
  enabled: z.boolean().default(true),
});

const fileDockerSchema = z
  .object({
    protectedContainers: z.array(z.string().trim().min(1)).optional(),
  })
  .optional();

const integrationsFileSchema = z.object({
  nas: fileNasSchema,
  qbittorrent: fileQbittorrentSchema,
  moviepilot: fileMoviepilotSchema,
  downloaders: z.array(fileDownloaderSchema).optional(),
  docker: fileDockerSchema,
});

function isValidHttpUrl(val: string): boolean {
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const optionalTrimmedUpdate = z.preprocess((val) => {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().optional());

const optionalUrlUpdate = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    return trimmed === '' ? null : trimmed;
  },
  z
    .string()
    .refine(isValidHttpUrl, { message: '必须是有效的 http:// 或 https:// 地址' })
    .nullable()
    .optional(),
);

const optionalPortUpdate = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null || val === '') return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '') return null;
      if (!/^\d+$/.test(trimmed)) return Number.NaN;
      return Number(trimmed);
    }
    return val;
  },
  z
    .number({ message: '端口必须是 1 到 65535 之间的整数' })
    .int('端口必须是 1 到 65535 之间的整数')
    .min(1, '端口必须是 1 到 65535 之间的整数')
    .max(65535, '端口必须是 1 到 65535 之间的整数')
    .nullable()
    .optional(),
);

// 敏感字段更新：undefined 或 "" 表示保持不变；null 表示清除；非空字符串表示更新
const optionalSecretUpdate = z.preprocess((val) => {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val !== 'string') return val;
  return val === '' ? undefined : val;
}, z.string().min(1).nullable().optional());

const nasPutSchema = z.object({
  host: optionalTrimmedUpdate,
  port: optionalPortUpdate,
  user: optionalTrimmedUpdate,
  keyPath: optionalTrimmedUpdate,
});

const qbittorrentPutSchema = z.object({
  url: optionalUrlUpdate,
  username: optionalTrimmedUpdate,
  password: optionalSecretUpdate,
});

const moviepilotPutSchema = z.object({
  url: optionalUrlUpdate,
  apiToken: optionalSecretUpdate,
});

const downloaderTagSchema = z.enum(DOWNLOADER_TAGS, {
  message: '用途标签必须是 download、brush 或 seed 之一',
});

const downloaderPutItemSchema = z.object({
  id: z.preprocess((val) => {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    return trimmed === '' ? undefined : trimmed;
  }, z.string().regex(DOWNLOADER_ID_REGEX, '实例 ID 仅支持字母、数字、下划线和连字符，且必须以字母或数字开头').optional()),
  name: z.string({ message: '实例名称必须填写' }).trim().min(1, '实例名称不能为空'),
  type: z.enum(['qbittorrent', 'transmission'], {
    message: '下载器类型必须是 qbittorrent 或 transmission',
  }),
  url: z
    .string({ message: '服务地址必须填写' })
    .trim()
    .refine(isValidHttpUrl, { message: '服务地址必须是有效的 http:// 或 https:// 地址' }),
  username: z.preprocess(
    (val) => (val === undefined || val === null ? '' : val),
    z.string({ message: '用户名必须是字符串' }).trim(),
  ),
  password: optionalSecretUpdate,
  tags: z.array(downloaderTagSchema, { message: 'tags 必须是数组' }).default([]),
  enabled: z.boolean({ message: 'enabled 必须是布尔值' }).default(true),
});

const downloadersPutPayloadSchema = z.object({
  downloaders: z.array(downloaderPutItemSchema, { message: 'downloaders 必须是数组' }),
});

interface FileReadState {
  data: IntegrationsFileData;
  error?: string;
}

export interface IntegrationsStore {
  getView: () => IntegrationsViewResponse;
  saveModule: (moduleName: string, rawBody: unknown) => SaveIntegrationResult;
  getDownloadersView: () => DownloadersListResponse;
  saveDownloaders: (rawBody: unknown) => SaveDownloadersResult;
  resolveNasConfig: (override?: NasTestOverride) => ResolvedNasConfig;
  resolveQbittorrentConfig: (override?: QbittorrentTestOverride) => ResolvedQbittorrentConfig;
  resolveDownloadersConfig: () => ResolvedDownloadersConfig;
  resolveDownloaderById: (id: string) => ResolvedDownloaderInstance | null;
  resolveMoviepilotConfig: (override?: MoviepilotTestOverride) => ResolvedMoviepilotConfig;
  getProtectedDockerContainers: () => string[];
  hasConfiguredDownloaders: () => boolean;
  getMergedKeyPresence: () => Partial<Record<ConfigKey, boolean>>;
  collectRuntimeSecrets: () => string[];
}

export interface CreateIntegrationsStoreOptions {
  logger?: SafeLogger;
}

function buildPublicField<T extends string | number>(
  envVal: T | undefined,
  fileVal: T | undefined,
): PublicIntegrationField<T> {
  if (envVal !== undefined) {
    return { source: 'env', set: true, value: envVal };
  }
  if (fileVal !== undefined) {
    return { source: 'file', set: true, value: fileVal };
  }
  return { source: 'unset', set: false };
}

function buildPublicSecretField(hasEnv: boolean, hasFile: boolean): PublicSecretIntegrationField {
  if (hasEnv) {
    return { source: 'env', set: true };
  }
  if (hasFile) {
    return { source: 'file', set: true };
  }
  return { source: 'unset', set: false };
}

function resolveNonSecretWithOverride<T>(
  envVal: T | undefined,
  fileVal: T | undefined,
  overrideVal: T | null | undefined,
): T | undefined {
  if (overrideVal === null) {
    return undefined;
  }
  if (overrideVal !== undefined) {
    return overrideVal;
  }
  return envVal !== undefined ? envVal : fileVal;
}

function normalizeOverrideString(val: string | null | undefined): string | null | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeOverridePort(val: number | string | null | undefined): number | null | undefined {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  const num = typeof val === 'number' ? val : Number(val.trim());
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    return undefined;
  }
  return num;
}

function normalizeOverrideSecret(val: string | null | undefined): string | null | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null;
  return val === '' ? undefined : val;
}

function resolveFieldSource(hasEnv: boolean, hasFile: boolean): IntegrationFieldSource {
  if (hasEnv) return 'env';
  if (hasFile) return 'file';
  return 'unset';
}

function writeJsonAtomicWithBackup(filePath: string, data: IntegrationsFileData): void {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${baseName}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`,
  );

  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
    const content = `${JSON.stringify(data, null, 2)}\n`;
    fs.writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 忽略清理失败
      }
    }
    throw err;
  }
}

/**
 * 创建加密的集成凭据存储，支持 .env 优先级覆盖、AES-256-GCM 加密与原子写入。
 */
export function createIntegrationsStore(
  config: AppConfig,
  options?: CreateIntegrationsStoreOptions,
): IntegrationsStore {
  const logger = options?.logger;
  const encryptionKey = deriveIntegrationKey({
    configEncryptionKey: config.app.CONFIG_ENCRYPTION_KEY,
    sessionSecret: config.auth.SESSION_SECRET,
  });

  function getConfiguredFilePath(): string | null {
    const configured = config.app.INTEGRATIONS_FILE;
    if (!configured) return null;
    return resolveRepoRelativePath(configured);
  }

  function readFileState(): FileReadState {
    const filePath = getConfiguredFilePath();
    if (!filePath) {
      return { data: {} };
    }

    let rawText: string;
    try {
      rawText = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { data: {} };
      }
      return { data: {}, error: '无法读取集成凭据文件，请检查文件权限' };
    }

    if (!rawText.trim()) {
      return { data: {} };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      return { data: {}, error: '集成凭据文件 JSON 格式无效' };
    }

    const parsed = integrationsFileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { data: {}, error: '集成凭据文件数据结构无效' };
    }

    return { data: parsed.data };
  }

  function tryDecryptField(field: EncryptedFieldValue | undefined): string | undefined {
    if (!field) return undefined;
    return decryptSecret(field, encryptionKey);
  }

  function isDownloadersMockEnabled(): boolean {
    return Boolean(config.downloaders?.DOWNLOADERS_MOCK || config.qbittorrent?.QBIT_MOCK);
  }

  function hasEnvQbittorrent(): boolean {
    return Boolean(
      config.keyPresence.QBIT_URL ||
      config.keyPresence.QBIT_USERNAME ||
      config.keyPresence.QBIT_PASSWORD,
    );
  }

  function buildMockDownloaders(includePasswords: boolean): ResolvedDownloaderInstance[] {
    return [
      {
        id: 'mock-qb-download',
        name: 'qB 下载',
        type: 'qbittorrent',
        url: 'http://192.0.2.10:8080',
        username: 'demo',
        ...(includePasswords ? { password: 'demo-mock-password' } : {}),
        tags: ['download'],
        enabled: true,
        source: 'mock',
        readonly: true,
      },
      {
        id: 'mock-qb-brush',
        name: 'qB 刷流',
        type: 'qbittorrent',
        url: 'http://192.0.2.11:8080',
        username: 'demo',
        ...(includePasswords ? { password: 'demo-mock-password' } : {}),
        tags: ['brush'],
        enabled: true,
        source: 'mock',
        readonly: true,
      },
      {
        id: 'mock-tr-seed',
        name: 'TR 保种',
        type: 'transmission',
        url: 'http://192.0.2.12:9091',
        username: 'demo',
        ...(includePasswords ? { password: 'demo-mock-password' } : {}),
        tags: ['seed'],
        enabled: true,
        source: 'mock',
        readonly: true,
      },
    ];
  }

  function buildLegacyMigratedInstance(
    state: FileReadState,
    includePassword: boolean,
  ): { instance: ResolvedDownloaderInstance; passwordSet: boolean } | null {
    const envQbit = config.qbittorrent;
    const fileQbit = state.data.qbittorrent;
    const envHasAny = hasEnvQbittorrent();
    const fileHasAny = Boolean(fileQbit?.url || fileQbit?.username || fileQbit?.password);
    if (!envHasAny && !fileHasAny) {
      return null;
    }

    const url = envQbit?.QBIT_URL ?? fileQbit?.url ?? '';
    const username = envQbit?.QBIT_USERNAME ?? fileQbit?.username ?? '';
    const passwordSet = Boolean(envQbit?.QBIT_PASSWORD || fileQbit?.password);
    let password: string | undefined;
    if (includePassword) {
      if (envQbit?.QBIT_PASSWORD) {
        password = envQbit.QBIT_PASSWORD;
      } else {
        password = tryDecryptField(fileQbit?.password);
      }
    }

    return {
      passwordSet,
      instance: {
        id: 'qbittorrent-default',
        name: 'qBittorrent',
        type: 'qbittorrent',
        url,
        username,
        ...(password !== undefined ? { password } : {}),
        tags: [],
        enabled: true,
        source: envHasAny ? 'env' : 'file',
        readonly: envHasAny,
      },
    };
  }

  function resolveDownloaderEntries(
    state: FileReadState,
    includePassword: boolean,
  ): Array<{ instance: ResolvedDownloaderInstance; passwordSet: boolean }> {
    const fileList = state.data.downloaders;
    if (fileList && fileList.length > 0) {
      const entries: Array<{ instance: ResolvedDownloaderInstance; passwordSet: boolean }> =
        fileList.map((item) => {
          const password = includePassword ? tryDecryptField(item.password) : undefined;
          return {
            passwordSet: Boolean(item.password),
            instance: {
              id: item.id,
              name: item.name,
              type: item.type,
              url: item.url,
              username: item.username,
              ...(password !== undefined ? { password } : {}),
              tags: [...item.tags],
              enabled: item.enabled,
              source: 'file',
              readonly: false,
            },
          };
        });

      // 若 .env 配置了旧版 QBIT_* 且文件列表里未包含 qbittorrent-default，仍保留只读 env 实例
      if (hasEnvQbittorrent() && !entries.some((e) => e.instance.id === 'qbittorrent-default')) {
        const legacyEnv = buildLegacyMigratedInstance(state, includePassword);
        if (legacyEnv) {
          entries.unshift(legacyEnv);
        }
      }

      return entries;
    }

    const migrated = buildLegacyMigratedInstance(state, includePassword);
    return migrated ? [migrated] : [];
  }

  function getDownloadersViewFromState(state: FileReadState): DownloadersListResponse {
    const mock = isDownloadersMockEnabled();
    if (mock) {
      const mockList = buildMockDownloaders(false);
      return {
        configured: true,
        fileConfigured: Boolean(config.app.INTEGRATIONS_FILE),
        mock: true,
        downloaders: mockList.map((item) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          url: item.url,
          username: item.username,
          passwordSet: true,
          tags: item.tags,
          enabled: item.enabled,
          source: 'mock',
          readonly: true,
          readonlyReason: '当前处于模拟模式（DOWNLOADERS_MOCK / QBIT_MOCK）',
        })),
        ...(state.error ? { error: state.error } : {}),
      };
    }

    const entries = resolveDownloaderEntries(state, false);
    const downloaders: DownloaderPublicConfig[] = entries.map(({ instance, passwordSet }) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type,
      url: instance.url,
      username: instance.username,
      passwordSet,
      tags: instance.tags,
      enabled: instance.enabled,
      source: instance.source,
      readonly: instance.readonly,
      ...(instance.source === 'env' ? { readonlyReason: '由 .env 管理' } : {}),
    }));

    return {
      configured: downloaders.length > 0,
      fileConfigured: Boolean(config.app.INTEGRATIONS_FILE),
      mock: false,
      downloaders,
      ...(state.error ? { error: state.error } : {}),
    };
  }

  function generateStableDownloaderId(type: DownloaderType, usedIds: Set<string>): string {
    const prefix = type === 'qbittorrent' ? 'qb' : 'tr';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = `${prefix}-${randomBytes(4).toString('hex')}`;
      if (!usedIds.has(candidate)) {
        return candidate;
      }
    }
    return `${prefix}-${Date.now().toString(36)}`;
  }

  function getViewFromState(state: FileReadState): IntegrationsViewResponse {
    const nasEnv = config.nas;
    const nasFile = state.data.nas;
    const qbitEnv = config.qbittorrent;
    const qbitFile = state.data.qbittorrent;
    const mpEnv = config.moviepilot;
    const mpFile = state.data.moviepilot;

    const nasHost = buildPublicField(nasEnv?.NAS_SSH_HOST, nasFile?.host);
    const nasPort = buildPublicField(nasEnv?.NAS_SSH_PORT, nasFile?.port);
    const nasUser = buildPublicField(nasEnv?.NAS_SSH_USER, nasFile?.user);
    const nasKeyPath = buildPublicField(nasEnv?.NAS_SSH_KEY_PATH, nasFile?.keyPath);

    const qbitUrl = buildPublicField(qbitEnv?.QBIT_URL, qbitFile?.url);
    const qbitUsername = buildPublicField(qbitEnv?.QBIT_USERNAME, qbitFile?.username);
    const qbitPassword = buildPublicSecretField(
      Boolean(qbitEnv?.QBIT_PASSWORD),
      Boolean(qbitFile?.password),
    );

    const mpUrl = buildPublicField(mpEnv?.MOVIEPILOT_URL, mpFile?.url);
    const mpToken = buildPublicSecretField(
      Boolean(mpEnv?.MOVIEPILOT_API_TOKEN),
      Boolean(mpFile?.apiToken),
    );

    const nasMock = Boolean(nasEnv?.NAS_MOCK);
    const qbitMock = Boolean(qbitEnv?.QBIT_MOCK);
    const mpMock = Boolean(mpEnv?.MOVIEPILOT_MOCK);

    return {
      fileConfigured: Boolean(config.app.INTEGRATIONS_FILE),
      modules: {
        nas: {
          configured: nasMock || (nasHost.set && nasPort.set && nasUser.set && nasKeyPath.set),
          mock: nasMock,
          fields: {
            host: nasHost,
            port: nasPort,
            user: nasUser,
            keyPath: nasKeyPath,
          },
        },
        qbittorrent: {
          configured: qbitMock || (qbitUrl.set && qbitUsername.set && qbitPassword.set),
          mock: qbitMock,
          fields: {
            url: qbitUrl,
            username: qbitUsername,
            password: qbitPassword,
          },
        },
        moviepilot: {
          configured: mpMock || (mpUrl.set && mpToken.set),
          mock: mpMock,
          fields: {
            url: mpUrl,
            apiToken: mpToken,
          },
        },
      },
      ...(state.error ? { error: state.error } : {}),
    };
  }

  function isModuleName(value: string): value is IntegrationModuleName {
    return value === 'nas' || value === 'qbittorrent' || value === 'moviepilot';
  }

  return {
    getView(): IntegrationsViewResponse {
      return getViewFromState(readFileState());
    },

    saveModule(moduleName: string, rawBody: unknown): SaveIntegrationResult {
      if (!isModuleName(moduleName)) {
        return { ok: false, status: 400, error: '不支持的集成模块名称' };
      }

      const filePath = getConfiguredFilePath();
      if (!filePath) {
        return {
          ok: false,
          status: 400,
          error: '尚未配置集成凭据文件（INTEGRATIONS_FILE），无法保存',
        };
      }

      const state = readFileState();
      if (state.error) {
        return { ok: false, status: 500, error: state.error };
      }

      const nextData: IntegrationsFileData = {
        ...(state.data.nas ? { nas: { ...state.data.nas } } : {}),
        ...(state.data.qbittorrent ? { qbittorrent: { ...state.data.qbittorrent } } : {}),
        ...(state.data.moviepilot ? { moviepilot: { ...state.data.moviepilot } } : {}),
        ...(state.data.downloaders ? { downloaders: [...state.data.downloaders] } : {}),
        ...(state.data.docker ? { docker: { ...state.data.docker } } : {}),
      };

      if (moduleName === 'nas') {
        const parsed = nasPutSchema.safeParse(rawBody);
        if (!parsed.success) {
          const details = parsed.error.issues.map((issue) => {
            const p = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
            return `${p}${issue.message}`;
          });
          return {
            ok: false,
            status: 400,
            error: `参数校验失败：${details[0] ?? '请检查输入格式'}`,
            details,
          };
        }

        const input = parsed.data;
        const conflicts: string[] = [];
        if (input.host !== undefined && config.keyPresence.NAS_SSH_HOST) {
          conflicts.push('主机地址（NAS_SSH_HOST）');
        }
        if (input.port !== undefined && config.keyPresence.NAS_SSH_PORT) {
          conflicts.push('SSH 端口（NAS_SSH_PORT）');
        }
        if (input.user !== undefined && config.keyPresence.NAS_SSH_USER) {
          conflicts.push('SSH 用户名（NAS_SSH_USER）');
        }
        if (input.keyPath !== undefined && config.keyPresence.NAS_SSH_KEY_PATH) {
          conflicts.push('私钥路径（NAS_SSH_KEY_PATH）');
        }
        if (conflicts.length > 0) {
          return {
            ok: false,
            status: 409,
            error: `${conflicts.join('、')}：该项由 .env 管理`,
          };
        }

        const current = { ...(nextData.nas ?? {}) };
        if (input.host !== undefined) {
          if (input.host === null) delete current.host;
          else current.host = input.host;
        }
        if (input.port !== undefined) {
          if (input.port === null) delete current.port;
          else current.port = input.port;
        }
        if (input.user !== undefined) {
          if (input.user === null) delete current.user;
          else current.user = input.user;
        }
        if (input.keyPath !== undefined) {
          if (input.keyPath === null) delete current.keyPath;
          else current.keyPath = input.keyPath;
        }

        if (Object.keys(current).length > 0) {
          nextData.nas = current;
        } else {
          delete nextData.nas;
        }
      } else if (moduleName === 'qbittorrent') {
        const parsed = qbittorrentPutSchema.safeParse(rawBody);
        if (!parsed.success) {
          const details = parsed.error.issues.map((issue) => {
            const p = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
            return `${p}${issue.message}`;
          });
          return {
            ok: false,
            status: 400,
            error: `参数校验失败：${details[0] ?? '请检查输入格式'}`,
            details,
          };
        }

        const input = parsed.data;
        const conflicts: string[] = [];
        if (input.url !== undefined && config.keyPresence.QBIT_URL) {
          conflicts.push('服务地址（QBIT_URL）');
        }
        if (input.username !== undefined && config.keyPresence.QBIT_USERNAME) {
          conflicts.push('用户名（QBIT_USERNAME）');
        }
        if (input.password !== undefined && config.keyPresence.QBIT_PASSWORD) {
          conflicts.push('密码（QBIT_PASSWORD）');
        }
        if (conflicts.length > 0) {
          return {
            ok: false,
            status: 409,
            error: `${conflicts.join('、')}：该项由 .env 管理`,
          };
        }

        const current = { ...(nextData.qbittorrent ?? {}) };
        if (input.url !== undefined) {
          if (input.url === null) delete current.url;
          else current.url = input.url;
        }
        if (input.username !== undefined) {
          if (input.username === null) delete current.username;
          else current.username = input.username;
        }
        if (input.password !== undefined) {
          if (input.password === null) delete current.password;
          else current.password = encryptSecret(input.password, encryptionKey);
        }

        if (Object.keys(current).length > 0) {
          nextData.qbittorrent = current;
        } else {
          delete nextData.qbittorrent;
        }
      } else {
        const parsed = moviepilotPutSchema.safeParse(rawBody);
        if (!parsed.success) {
          const details = parsed.error.issues.map((issue) => {
            const p = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
            return `${p}${issue.message}`;
          });
          return {
            ok: false,
            status: 400,
            error: `参数校验失败：${details[0] ?? '请检查输入格式'}`,
            details,
          };
        }

        const input = parsed.data;
        const conflicts: string[] = [];
        if (input.url !== undefined && config.keyPresence.MOVIEPILOT_URL) {
          conflicts.push('服务地址（MOVIEPILOT_URL）');
        }
        if (input.apiToken !== undefined && config.keyPresence.MOVIEPILOT_API_TOKEN) {
          conflicts.push('API 令牌（MOVIEPILOT_API_TOKEN）');
        }
        if (conflicts.length > 0) {
          return {
            ok: false,
            status: 409,
            error: `${conflicts.join('、')}：该项由 .env 管理`,
          };
        }

        const current = { ...(nextData.moviepilot ?? {}) };
        if (input.url !== undefined) {
          if (input.url === null) delete current.url;
          else current.url = input.url;
        }
        if (input.apiToken !== undefined) {
          if (input.apiToken === null) delete current.apiToken;
          else current.apiToken = encryptSecret(input.apiToken, encryptionKey);
        }

        if (Object.keys(current).length > 0) {
          nextData.moviepilot = current;
        } else {
          delete nextData.moviepilot;
        }
      }

      try {
        writeJsonAtomicWithBackup(filePath, nextData);
      } catch {
        logger?.error(`保存集成模块 ${moduleName} 失败：写入文件异常`);
        return {
          ok: false,
          status: 500,
          error: '写入集成凭据文件失败，请检查目录权限',
        };
      }

      return { ok: true, data: getViewFromState({ data: nextData }) };
    },

    getDownloadersView(): DownloadersListResponse {
      return getDownloadersViewFromState(readFileState());
    },

    saveDownloaders(rawBody: unknown): SaveDownloadersResult {
      const filePath = getConfiguredFilePath();
      if (!filePath) {
        return {
          ok: false,
          status: 400,
          error: '尚未配置集成凭据文件（INTEGRATIONS_FILE），无法保存',
        };
      }

      const state = readFileState();
      if (state.error) {
        return { ok: false, status: 500, error: state.error };
      }

      const parsed = downloadersPutPayloadSchema.safeParse(rawBody);
      if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => {
          const p = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
          return `${p}${issue.message}`;
        });
        return {
          ok: false,
          status: 400,
          error: `参数校验失败：${details[0] ?? '请检查输入格式'}`,
          details,
        };
      }

      const envManaged = hasEnvQbittorrent();
      const existingById = new Map<string, StoredDownloaderRecord>();
      for (const existing of state.data.downloaders ?? []) {
        existingById.set(existing.id, existing);
      }

      const usedIds = new Set<string>();
      for (const item of parsed.data.downloaders) {
        if (item.id) {
          if (usedIds.has(item.id)) {
            return {
              ok: false,
              status: 400,
              error: `下载器实例 ID 重复：${item.id}`,
            };
          }
          usedIds.add(item.id);
        }
      }

      const normalizedRecords: StoredDownloaderRecord[] = [];
      for (const item of parsed.data.downloaders) {
        const id = item.id ?? generateStableDownloaderId(item.type, usedIds);
        usedIds.add(id);

        if (envManaged && id === 'qbittorrent-default') {
          return {
            ok: false,
            status: 409,
            error: 'qbittorrent-default：该项由 .env 管理',
          };
        }

        const dedupTags: DownloaderTag[] = [];
        for (const tag of item.tags) {
          if (!dedupTags.includes(tag)) {
            dedupTags.push(tag);
          }
        }

        const existingRecord = existingById.get(id);
        const legacyPassword =
          !state.data.downloaders?.length && id === 'qbittorrent-default'
            ? state.data.qbittorrent?.password
            : undefined;
        const previousEncrypted = existingRecord?.password ?? legacyPassword;

        let nextEncryptedPassword: EncryptedFieldValue | undefined;
        if (item.password === null) {
          nextEncryptedPassword = undefined;
        } else if (item.password !== undefined) {
          nextEncryptedPassword = encryptSecret(item.password, encryptionKey);
        } else {
          nextEncryptedPassword = previousEncrypted;
        }

        normalizedRecords.push({
          id,
          name: item.name,
          type: item.type,
          url: item.url,
          username: item.username,
          ...(nextEncryptedPassword ? { password: nextEncryptedPassword } : {}),
          tags: dedupTags,
          enabled: item.enabled,
        });
      }

      const nextData: IntegrationsFileData = {
        ...(state.data.nas ? { nas: { ...state.data.nas } } : {}),
        ...(state.data.qbittorrent ? { qbittorrent: { ...state.data.qbittorrent } } : {}),
        ...(state.data.moviepilot ? { moviepilot: { ...state.data.moviepilot } } : {}),
        ...(state.data.docker ? { docker: { ...state.data.docker } } : {}),
        downloaders: normalizedRecords,
      };

      // 若旧版文件 qbittorrent 段已被迁移或删空，且不再保留 qbittorrent-default，则清理旧段防止删空后复活
      if (!normalizedRecords.some((item) => item.id === 'qbittorrent-default')) {
        delete nextData.qbittorrent;
      }

      try {
        writeJsonAtomicWithBackup(filePath, nextData);
      } catch {
        logger?.error('保存下载器实例配置失败：写入文件异常');
        return {
          ok: false,
          status: 500,
          error: '写入集成凭据文件失败，请检查目录权限',
        };
      }

      return { ok: true, data: getDownloadersViewFromState({ data: nextData }) };
    },

    resolveNasConfig(override?: NasTestOverride): ResolvedNasConfig {
      const state = readFileState();
      const fileNas = state.data.nas;
      const envNas = config.nas;

      const host = resolveNonSecretWithOverride(
        envNas?.NAS_SSH_HOST,
        fileNas?.host,
        normalizeOverrideString(override?.host),
      );
      const port = resolveNonSecretWithOverride(
        envNas?.NAS_SSH_PORT,
        fileNas?.port,
        normalizeOverridePort(override?.port),
      );
      const user = resolveNonSecretWithOverride(
        envNas?.NAS_SSH_USER,
        fileNas?.user,
        normalizeOverrideString(override?.user),
      );
      const keyPath = resolveNonSecretWithOverride(
        envNas?.NAS_SSH_KEY_PATH,
        fileNas?.keyPath,
        normalizeOverrideString(override?.keyPath),
      );

      const mock = Boolean(envNas?.NAS_MOCK);
      const configured = Boolean(host && port && user && keyPath);
      return {
        configured: mock || configured,
        mock,
        ...(host ? { host } : {}),
        ...(port ? { port } : {}),
        ...(user ? { user } : {}),
        ...(keyPath ? { keyPath } : {}),
        cacheSeconds: clampSshStatusCacheSeconds(
          envNas?.NAS_CACHE_SECONDS ?? DEFAULT_SSH_STATUS_CACHE_SECONDS,
        ),
      };
    },

    resolveQbittorrentConfig(override?: QbittorrentTestOverride): ResolvedQbittorrentConfig {
      const state = readFileState();
      const fileQbit = state.data.qbittorrent;
      const envQbit = config.qbittorrent;

      const url = resolveNonSecretWithOverride(
        envQbit?.QBIT_URL,
        fileQbit?.url,
        normalizeOverrideString(override?.url),
      );
      const username = resolveNonSecretWithOverride(
        envQbit?.QBIT_USERNAME,
        fileQbit?.username,
        normalizeOverrideString(override?.username),
      );

      const overridePass = normalizeOverrideSecret(override?.password);
      let password: string | undefined;
      if (overridePass === null) {
        password = undefined;
      } else if (overridePass !== undefined) {
        password = overridePass;
      } else if (envQbit?.QBIT_PASSWORD) {
        password = envQbit.QBIT_PASSWORD;
      } else {
        password = tryDecryptField(fileQbit?.password);
      }

      const mock = Boolean(envQbit?.QBIT_MOCK);
      const configured = Boolean(url && username && password);
      return {
        configured: mock || configured,
        mock,
        ...(url ? { url } : {}),
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
        cacheSeconds: envQbit?.QBIT_CACHE_SECONDS ?? 10,
        timeoutMs: envQbit?.QBIT_TIMEOUT_MS ?? 8000,
      };
    },

    resolveDownloadersConfig(): ResolvedDownloadersConfig {
      const cacheSeconds =
        config.downloaders?.DOWNLOADER_CACHE_SECONDS ??
        config.qbittorrent?.QBIT_CACHE_SECONDS ??
        10;
      const timeoutMs =
        config.downloaders?.DOWNLOADER_TIMEOUT_MS ?? config.qbittorrent?.QBIT_TIMEOUT_MS ?? 8000;
      const activeTasksLimit = config.downloaders?.DOWNLOADER_ACTIVE_TASKS_LIMIT ?? 10;
      const mock = isDownloadersMockEnabled();

      if (mock) {
        return {
          configured: true,
          mock: true,
          cacheSeconds,
          timeoutMs,
          activeTasksLimit,
          instances: buildMockDownloaders(true),
        };
      }

      const state = readFileState();
      const entries = resolveDownloaderEntries(state, true);
      const instances = entries.map((entry) => entry.instance);
      return {
        configured: instances.length > 0,
        mock: false,
        cacheSeconds,
        timeoutMs,
        activeTasksLimit,
        instances,
      };
    },

    resolveDownloaderById(id: string): ResolvedDownloaderInstance | null {
      const resolved = this.resolveDownloadersConfig();
      return resolved.instances.find((item) => item.id === id) ?? null;
    },

    getProtectedDockerContainers(): string[] {
      const envProtected = config.nas?.DOCKER_PROTECTED_CONTAINERS ?? ['homedash'];
      const state = readFileState();
      const fileProtected = state.data.docker?.protectedContainers ?? [];
      const merged: string[] = [];
      for (const name of [...envProtected, ...fileProtected]) {
        const trimmed = name.trim();
        if (trimmed && !merged.includes(trimmed)) {
          merged.push(trimmed);
        }
      }
      return merged;
    },

    hasConfiguredDownloaders(): boolean {
      if (isDownloadersMockEnabled()) {
        return true;
      }
      const state = readFileState();
      return resolveDownloaderEntries(state, false).length > 0;
    },

    resolveMoviepilotConfig(override?: MoviepilotTestOverride): ResolvedMoviepilotConfig {
      const state = readFileState();
      const fileMp = state.data.moviepilot;
      const envMp = config.moviepilot;

      const url = resolveNonSecretWithOverride(
        envMp?.MOVIEPILOT_URL,
        fileMp?.url,
        normalizeOverrideString(override?.url),
      );

      const overrideToken = normalizeOverrideSecret(override?.apiToken);
      let apiToken: string | undefined;
      if (overrideToken === null) {
        apiToken = undefined;
      } else if (overrideToken !== undefined) {
        apiToken = overrideToken;
      } else if (envMp?.MOVIEPILOT_API_TOKEN) {
        apiToken = envMp.MOVIEPILOT_API_TOKEN;
      } else {
        apiToken = tryDecryptField(fileMp?.apiToken);
      }

      const mock = Boolean(envMp?.MOVIEPILOT_MOCK);
      const configured = Boolean(url && apiToken);
      return {
        configured: mock || configured,
        mock,
        ...(url ? { url } : {}),
        ...(apiToken ? { apiToken } : {}),
        cacheSeconds: envMp?.MOVIEPILOT_CACHE_SECONDS ?? 60,
        timeoutMs: envMp?.MOVIEPILOT_TIMEOUT_MS ?? 8000,
        activeLimit: envMp?.MOVIEPILOT_ACTIVE_LIMIT ?? 10,
      };
    },

    getMergedKeyPresence(): Partial<Record<ConfigKey, boolean>> {
      const state = readFileState();
      const fileNas = state.data.nas;
      const fileQbit = state.data.qbittorrent;
      const fileMp = state.data.moviepilot;

      return {
        NAS_SSH_HOST:
          resolveFieldSource(config.keyPresence.NAS_SSH_HOST, Boolean(fileNas?.host)) !== 'unset',
        NAS_SSH_PORT:
          resolveFieldSource(config.keyPresence.NAS_SSH_PORT, Boolean(fileNas?.port)) !== 'unset',
        NAS_SSH_USER:
          resolveFieldSource(config.keyPresence.NAS_SSH_USER, Boolean(fileNas?.user)) !== 'unset',
        NAS_SSH_KEY_PATH:
          resolveFieldSource(config.keyPresence.NAS_SSH_KEY_PATH, Boolean(fileNas?.keyPath)) !==
          'unset',
        QBIT_URL:
          resolveFieldSource(config.keyPresence.QBIT_URL, Boolean(fileQbit?.url)) !== 'unset',
        QBIT_USERNAME:
          resolveFieldSource(config.keyPresence.QBIT_USERNAME, Boolean(fileQbit?.username)) !==
          'unset',
        QBIT_PASSWORD:
          resolveFieldSource(config.keyPresence.QBIT_PASSWORD, Boolean(fileQbit?.password)) !==
          'unset',
        MOVIEPILOT_URL:
          resolveFieldSource(config.keyPresence.MOVIEPILOT_URL, Boolean(fileMp?.url)) !== 'unset',
        MOVIEPILOT_API_TOKEN:
          resolveFieldSource(config.keyPresence.MOVIEPILOT_API_TOKEN, Boolean(fileMp?.apiToken)) !==
          'unset',
      };
    },

    collectRuntimeSecrets(): string[] {
      const secrets: string[] = [];
      try {
        const qbit = this.resolveQbittorrentConfig();
        if (qbit.password) secrets.push(qbit.password);
      } catch {
        // 解密失败时忽略，避免影响启动或日志初始化
      }
      try {
        const mp = this.resolveMoviepilotConfig();
        if (mp.apiToken) secrets.push(mp.apiToken);
      } catch {
        // 解密失败时忽略
      }
      try {
        const downloaders = this.resolveDownloadersConfig();
        for (const item of downloaders.instances) {
          if (item.password) secrets.push(item.password);
        }
      } catch {
        // 解密失败时忽略
      }
      return secrets;
    },
  };
}
