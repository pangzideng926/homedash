import {
  ALL_CONFIG_KEYS,
  AUTH_REQUIRED_KEYS,
  CONFIG_MODULE_KEYS,
  CONFIG_MODULE_LABELS,
  CONFIG_MODULE_NAMES,
  MOVIEPILOT_REQUIRED_KEYS,
  NAS_REQUIRED_KEYS,
  OPTIONAL_CONFIG_MODULES,
  QBIT_REQUIRED_KEYS,
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
  extraKeyPresence?: Partial<Record<ConfigKey, boolean>>,
): Record<ConfigKey, boolean> {
  const presence = {} as Record<ConfigKey, boolean>;
  if (isAppConfig(source)) {
    for (const key of ALL_CONFIG_KEYS) {
      presence[key] = Boolean(source.keyPresence[key] || extraKeyPresence?.[key]);
    }
    return presence;
  }

  const rawEnv = source ?? process.env;
  for (const key of ALL_CONFIG_KEYS) {
    presence[key] = Boolean(isEnvValueFilled(rawEnv[key]) || extraKeyPresence?.[key]);
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

function resolveRequiredKeysOrMockStatus(
  isMockEnabled: boolean,
  requiredKeys: readonly ConfigKey[],
  presence: Readonly<Record<ConfigKey, boolean>>,
): ConfigModuleStatusValue {
  if (isMockEnabled) {
    return 'configured';
  }
  const filledCount = requiredKeys.filter((key) => presence[key]).length;
  if (filledCount === 0) return 'unconfigured';
  if (filledCount === requiredKeys.length) return 'configured';
  return 'incomplete';
}

function resolveOptionalModuleStatus(
  moduleId: (typeof OPTIONAL_CONFIG_MODULES)[number],
  presence: Readonly<Record<ConfigKey, boolean>>,
  source?: AppConfig | Record<string, string | undefined>,
  moduleConfiguredOverrides?: Partial<Record<ConfigModuleName, boolean>>,
): ConfigModuleStatusValue {
  if (moduleId === 'vps') {
    return presence.VPS_LIST_FILE ? 'configured' : 'unconfigured';
  }

  if (moduleId === 'devices') {
    const isMockEnabled = isAppConfig(source)
      ? Boolean(source.devices?.DEVICES_MOCK)
      : isEnvTruthy((source ?? process.env).DEVICES_MOCK);

    return presence.DEVICES_FILE || isMockEnabled ? 'configured' : 'unconfigured';
  }

  if (moduleId === 'windows') {
    const isMockEnabled = isAppConfig(source)
      ? Boolean(source.windows?.WIN_MOCK)
      : isEnvTruthy((source ?? process.env).WIN_MOCK);
    return resolveRequiredKeysOrMockStatus(isMockEnabled, WINDOWS_SSH_REQUIRED_KEYS, presence);
  }

  if (moduleId === 'nas') {
    const isMockEnabled = isAppConfig(source)
      ? Boolean(source.nas?.NAS_MOCK)
      : isEnvTruthy((source ?? process.env).NAS_MOCK);
    return resolveRequiredKeysOrMockStatus(isMockEnabled, NAS_REQUIRED_KEYS, presence);
  }

  if (moduleId === 'downloaders') {
    const isMockEnabled = isAppConfig(source)
      ? Boolean(source.downloaders?.DOWNLOADERS_MOCK || source.qbittorrent?.QBIT_MOCK)
      : isEnvTruthy((source ?? process.env).DOWNLOADERS_MOCK) ||
        isEnvTruthy((source ?? process.env).QBIT_MOCK);
    if (isMockEnabled || moduleConfiguredOverrides?.downloaders) {
      return 'configured';
    }
    const qbitStatus = resolveRequiredKeysOrMockStatus(false, QBIT_REQUIRED_KEYS, presence);
    return qbitStatus === 'configured' ? 'configured' : 'unconfigured';
  }

  if (moduleId === 'qbittorrent') {
    const isMockEnabled = isAppConfig(source)
      ? Boolean(source.qbittorrent?.QBIT_MOCK)
      : isEnvTruthy((source ?? process.env).QBIT_MOCK);
    return resolveRequiredKeysOrMockStatus(isMockEnabled, QBIT_REQUIRED_KEYS, presence);
  }

  const isMockEnabled = isAppConfig(source)
    ? Boolean(source.moviepilot?.MOVIEPILOT_MOCK)
    : isEnvTruthy((source ?? process.env).MOVIEPILOT_MOCK);
  return resolveRequiredKeysOrMockStatus(isMockEnabled, MOVIEPILOT_REQUIRED_KEYS, presence);
}

/**
 * 返回各模块配置状态（已配置/未配置/配置不完整）及各键是否已填写（布尔值），绝不包含任何配置值。
 */
export function getConfigStatus(
  source?: AppConfig | Record<string, string | undefined>,
  extraKeyPresence?: Partial<Record<ConfigKey, boolean>>,
  moduleConfiguredOverrides?: Partial<Record<ConfigModuleName, boolean>>,
): ConfigStatusReport {
  const presence = resolveKeyPresence(source, extraKeyPresence);

  const modules = {} as Record<ConfigModuleName, ConfigModuleStatus>;

  // app 模块全部键均有默认值，只要系统启动即处于已配置状态
  modules.app = buildModuleStatus('app', 'configured', presence);
  modules.auth = buildModuleStatus('auth', resolveAuthStatus(presence), presence);

  for (const moduleId of OPTIONAL_CONFIG_MODULES) {
    modules[moduleId] = buildModuleStatus(
      moduleId,
      resolveOptionalModuleStatus(moduleId, presence, source, moduleConfiguredOverrides),
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
