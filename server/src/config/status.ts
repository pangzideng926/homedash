import {
  ALL_CONFIG_KEYS,
  AUTH_REQUIRED_KEYS,
  CONFIG_MODULE_KEYS,
  CONFIG_MODULE_LABELS,
  CONFIG_MODULE_NAMES,
  OPTIONAL_CONFIG_MODULES,
  WINDOWS_SSH_REQUIRED_KEYS,
  type AppConfig,
  type ConfigKey,
  type ConfigModuleName,
  type ConfigModuleStatus,
  type ConfigModuleStatusLabel,
  type ConfigModuleStatusValue,
  type ConfigStatusReport,
} from './definitions.js';
import { isEnvValueFilled } from './schema.js';

const STATUS_LABELS: Readonly<Record<ConfigModuleStatusValue, ConfigModuleStatusLabel>> = {
  configured: '已配置',
  unconfigured: '未配置',
  incomplete: '配置不完整',
};

function isAppConfig(source: unknown): source is AppConfig {
  return typeof source === 'object' && source !== null && 'keyPresence' in source;
}

function resolveKeyPresence(
  source?: AppConfig | Record<string, string | undefined>,
): Record<ConfigKey, boolean> {
  if (isAppConfig(source)) {
    return { ...source.keyPresence };
  }

  const rawEnv = source ?? process.env;
  const presence = {} as Record<ConfigKey, boolean>;
  for (const key of ALL_CONFIG_KEYS) {
    presence[key] = isEnvValueFilled(rawEnv[key]);
  }
  return presence;
}

function buildModuleStatus(
  moduleId: ConfigModuleName,
  status: ConfigModuleStatusValue,
  presence: Readonly<Record<ConfigKey, boolean>>,
): ConfigModuleStatus {
  const keys: Record<string, boolean> = {};
  for (const key of CONFIG_MODULE_KEYS[moduleId]) {
    keys[key] = Boolean(presence[key]);
  }

  return {
    id: moduleId,
    label: CONFIG_MODULE_LABELS[moduleId],
    status,
    statusLabel: STATUS_LABELS[status],
    keys,
  };
}

function resolveAuthStatus(
  presence: Readonly<Record<ConfigKey, boolean>>,
): ConfigModuleStatusValue {
  const allAuthKeysFilled = AUTH_REQUIRED_KEYS.every((key) => presence[key]);
  if (allAuthKeysFilled) {
    return 'configured';
  }

  const anyAuthKeyFilled = CONFIG_MODULE_KEYS.auth.some((key) => presence[key]);
  return anyAuthKeyFilled ? 'incomplete' : 'unconfigured';
}

function isEnvTruthy(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function resolveOptionalModuleStatus(
  moduleId: (typeof OPTIONAL_CONFIG_MODULES)[number],
  presence: Readonly<Record<ConfigKey, boolean>>,
  source?: AppConfig | Record<string, string | undefined>,
): ConfigModuleStatusValue {
  if (moduleId === 'vps') {
    return presence.VPS_LIST_FILE ? 'configured' : 'unconfigured';
  }

  if (moduleId === 'windows') {
    const isMockEnabled = isAppConfig(source)
      ? Boolean(source.windows?.WIN_MOCK)
      : isEnvTruthy((source ?? process.env).WIN_MOCK);

    if (isMockEnabled) {
      return 'configured';
    }

    const filledCount = WINDOWS_SSH_REQUIRED_KEYS.filter((key) => presence[key]).length;
    if (filledCount === 0) {
      return 'unconfigured';
    }
    if (filledCount === WINDOWS_SSH_REQUIRED_KEYS.length) {
      return 'configured';
    }
    return 'incomplete';
  }

  const keys = CONFIG_MODULE_KEYS[moduleId];
  const filledCount = keys.filter((key) => presence[key]).length;
  if (filledCount === 0) {
    return 'unconfigured';
  }
  if (filledCount === keys.length) {
    return 'configured';
  }
  return 'incomplete';
}

/**
 * 返回各模块配置状态（已配置/未配置/配置不完整）及各键是否已填写（布尔值），绝不包含任何配置值。
 */
export function getConfigStatus(
  source?: AppConfig | Record<string, string | undefined>,
): ConfigStatusReport {
  const presence = resolveKeyPresence(source);

  const modules = {} as Record<ConfigModuleName, ConfigModuleStatus>;

  // app 模块全部键均有默认值，只要系统启动即处于已配置状态
  modules.app = buildModuleStatus('app', 'configured', presence);
  modules.auth = buildModuleStatus('auth', resolveAuthStatus(presence), presence);

  for (const moduleId of OPTIONAL_CONFIG_MODULES) {
    modules[moduleId] = buildModuleStatus(
      moduleId,
      resolveOptionalModuleStatus(moduleId, presence, source),
      presence,
    );
  }

  for (const moduleId of CONFIG_MODULE_NAMES) {
    if (!modules[moduleId]) {
      modules[moduleId] = buildModuleStatus(moduleId, 'unconfigured', presence);
    }
  }

  return { modules };
}
