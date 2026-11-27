import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type AppConfig, type ConfigKey, type SafeLogger } from '../config/index.js';
import { resolveRepoRelativePath } from '../devices/store.js';
import { decryptSecret, deriveIntegrationKey, encryptSecret } from './crypto.js';
import type {
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
  ResolvedMoviepilotConfig,
  ResolvedNasConfig,
  ResolvedQbittorrentConfig,
  SaveIntegrationResult,
} from './types.js';

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

const integrationsFileSchema = z.object({
  nas: fileNasSchema,
  qbittorrent: fileQbittorrentSchema,
  moviepilot: fileMoviepilotSchema,
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

interface FileReadState {
  data: IntegrationsFileData;
  error?: string;
}

export interface IntegrationsStore {
  getView: () => IntegrationsViewResponse;
  saveModule: (moduleName: string, rawBody: unknown) => SaveIntegrationResult;
  resolveNasConfig: (override?: NasTestOverride) => ResolvedNasConfig;
  resolveQbittorrentConfig: (override?: QbittorrentTestOverride) => ResolvedQbittorrentConfig;
  resolveMoviepilotConfig: (override?: MoviepilotTestOverride) => ResolvedMoviepilotConfig;
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
        cacheSeconds: envNas?.NAS_CACHE_SECONDS ?? 30,
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
      return secrets;
    },
  };
}
