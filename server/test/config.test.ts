import { describe, expect, it, vi } from 'vitest';
import {
  collectSecretValues,
  ConfigError,
  createSafeLogger,
  formatConfigError,
  getConfigStatus,
  isSensitiveKey,
  parseConfig,
  REDACTED,
  redactText,
  redactValue,
  SENSITIVE_CONFIG_KEYS,
} from '../src/config/index.js';

const BASE_ENV = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD_HASH: 'scrypt$00112233445566778899aabbccddeeff$fedcba9876543210',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
};

describe('配置分组校验与状态报告', () => {
  it('解析基础必填项与默认配置值', () => {
    const prodConfig = parseConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
    });

    expect(prodConfig.app.PORT).toBe(3000);
    expect(prodConfig.app.HOST).toBe('0.0.0.0');
    expect(prodConfig.app.COOKIE_SECURE).toBe(true);
    expect(prodConfig.app.TRUST_PROXY).toBe(false);
    expect(prodConfig.app.TZ_DISPLAY).toBe('Asia/Shanghai');
    expect(prodConfig.auth.SESSION_TTL_HOURS).toBe(168);
    expect(prodConfig.auth.SESSION_TTL_SECONDS).toBe(168 * 3600);
    expect(prodConfig.auth.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(prodConfig.auth.LOGIN_LOCK_MINUTES).toBe(15);

    expect(prodConfig.nas).toBeUndefined();
    expect(prodConfig.qbittorrent).toBeUndefined();
    expect(prodConfig.moviepilot).toBeUndefined();
    expect(prodConfig.devices).toBeUndefined();
    expect(prodConfig.windows).toBeUndefined();
    expect(prodConfig.vps).toBeUndefined();

    const overrideConfig = parseConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'true',
      SESSION_TTL_HOURS: '24',
      LOGIN_MAX_ATTEMPTS: '3',
      LOGIN_LOCK_MINUTES: '30',
    });
    expect(overrideConfig.app.COOKIE_SECURE).toBe(false);
    expect(overrideConfig.app.TRUST_PROXY).toBe(true);
    expect(overrideConfig.auth.SESSION_TTL_HOURS).toBe(24);
    expect(overrideConfig.auth.LOGIN_MAX_ATTEMPTS).toBe(3);
    expect(overrideConfig.auth.LOGIN_LOCK_MINUTES).toBe(30);
  });

  it('缺少必填项或格式错误时抛出 ConfigError，列出变量名且绝不含变量值', () => {
    const shortSecret = 'test-short-secret-value';
    const invalidPort = 'not-a-valid-port-99999';
    const passwordHash = 'scrypt$secretSaltValue$secretHashValue';

    let caughtError: unknown;
    try {
      parseConfig({
        PORT: invalidPort,
        ADMIN_USERNAME: '',
        ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: shortSecret,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ConfigError);
    const configError = caughtError as ConfigError;
    const message = formatConfigError(configError);

    expect(message).toContain('PORT');
    expect(message).toContain('ADMIN_USERNAME');
    expect(message).toContain('SESSION_SECRET');

    expect(message).not.toContain(shortSecret);
    expect(message).not.toContain(invalidPort);
    expect(message).not.toContain(passwordHash);
    expect(configError.message).not.toContain(shortSecret);
    expect(configError.message).not.toContain(invalidPort);
    expect(configError.message).not.toContain(passwordHash);
  });

  it('nas/qbittorrent/moviepilot 允许仅部分填写环境变量，但已填项格式非法时仍报错且不泄露密钥', () => {
    const fakeQbitPassword = 'fake-qbit-password-999';
    const fakeMpToken = 'fake-mp-token-888';

    // 部分填写时允许正常解析（其余项可由网页集成配置补充）
    const partialConfig = parseConfig({
      ...BASE_ENV,
      NAS_SSH_HOST: '192.0.2.10',
      QBIT_URL: 'http://192.0.2.10:8080',
      QBIT_PASSWORD: fakeQbitPassword,
      MOVIEPILOT_API_TOKEN: fakeMpToken,
    });
    expect(partialConfig.nas?.NAS_SSH_HOST).toBe('192.0.2.10');
    expect(partialConfig.nas?.NAS_CACHE_SECONDS).toBe(30);
    expect(partialConfig.qbittorrent?.QBIT_CACHE_SECONDS).toBe(10);
    expect(partialConfig.qbittorrent?.QBIT_TIMEOUT_MS).toBe(8000);
    expect(partialConfig.moviepilot?.MOVIEPILOT_CACHE_SECONDS).toBe(60);
    expect(partialConfig.moviepilot?.MOVIEPILOT_TIMEOUT_MS).toBe(8000);

    // 已填项格式非法时仍抛出 ConfigError，且错误信息不含真实值
    let caughtError: unknown;
    try {
      parseConfig({
        ...BASE_ENV,
        NAS_SSH_PORT: '99999',
        QBIT_URL: 'invalid-qbit-url',
        QBIT_PASSWORD: fakeQbitPassword,
        MOVIEPILOT_URL: 'ftp://invalid.example.com',
        MOVIEPILOT_API_TOKEN: fakeMpToken,
        CONFIG_ENCRYPTION_KEY: 'short-key',
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ConfigError);
    const message = formatConfigError(caughtError as ConfigError);

    expect(message).toContain('NAS_SSH_PORT');
    expect(message).toContain('QBIT_URL');
    expect(message).toContain('MOVIEPILOT_URL');
    expect(message).toContain('CONFIG_ENCRYPTION_KEY');

    expect(message).not.toContain(fakeQbitPassword);
    expect(message).not.toContain(fakeMpToken);
    expect(message).not.toContain('short-key');
    expect(message).not.toContain('invalid-qbit-url');
  });

  it('可选模块全部未填为未配置，全部填写时解析成功并返回已配置状态', () => {
    const minimalConfig = parseConfig(BASE_ENV);
    const minimalStatus = getConfigStatus(minimalConfig);

    expect(minimalStatus.modules.app.status).toBe('configured');
    expect(minimalStatus.modules.auth.status).toBe('configured');
    expect(minimalStatus.modules.nas.status).toBe('unconfigured');
    expect(minimalStatus.modules.nas.statusLabel).toBe('未配置');
    expect(minimalStatus.modules.qbittorrent.status).toBe('unconfigured');
    expect(minimalStatus.modules.moviepilot.status).toBe('unconfigured');
    expect(minimalStatus.modules.devices.status).toBe('unconfigured');
    expect(minimalStatus.modules.windows.status).toBe('unconfigured');
    expect(minimalStatus.modules.windows.label).toContain('旧版兼容');
    expect(minimalStatus.modules.vps.status).toBe('unconfigured');

    const fullEnv = {
      ...BASE_ENV,
      NAS_SSH_HOST: '192.0.2.10',
      NAS_SSH_PORT: '22',
      NAS_SSH_USER: 'nasuser',
      NAS_SSH_KEY_PATH: './secrets/test-nas-key',
      QBIT_URL: 'http://192.0.2.10:8080',
      QBIT_USERNAME: 'qbituser',
      QBIT_PASSWORD: 'fake-qbit-password-999',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token-888',
      WIN_SSH_HOST: '192.0.2.20',
      WIN_SSH_PORT: '22',
      WIN_SSH_USER: 'winuser',
      WIN_SSH_KEY_PATH: './secrets/test-win-key',
      DEVICES_FILE: './secrets/devices.json',
      VPS_LIST_FILE: './secrets/vps.json',
    };

    const fullConfig = parseConfig(fullEnv);
    expect(fullConfig.nas?.NAS_SSH_PORT).toBe(22);
    expect(fullConfig.qbittorrent?.QBIT_URL).toBe('http://192.0.2.10:8080');
    expect(fullConfig.moviepilot?.MOVIEPILOT_URL).toBe('https://mp.example.com');
    expect(fullConfig.devices?.DEVICES_FILE).toBe('./secrets/devices.json');
    expect(fullConfig.devices?.DEVICE_SSH_TIMEOUT_MS).toBe(8000);
    expect(fullConfig.devices?.DEVICE_CACHE_SECONDS).toBe(30);
    expect(fullConfig.devices?.DEVICES_MOCK).toBe(false);
    expect(fullConfig.windows?.WIN_SSH_PORT).toBe(22);
    expect(fullConfig.windows?.WIN_SSH_TIMEOUT_MS).toBe(8000);
    expect(fullConfig.windows?.WIN_CACHE_SECONDS).toBe(30);
    expect(fullConfig.windows?.WIN_MOCK).toBe(false);
    expect(fullConfig.vps?.VPS_LIST_FILE).toBe('./secrets/vps.json');
    expect(fullConfig.vps?.VPS_READONLY).toBe(false);

    const fullStatus = getConfigStatus(fullConfig);
    expect(fullStatus.modules.nas.status).toBe('configured');
    expect(fullStatus.modules.qbittorrent.status).toBe('configured');
    expect(fullStatus.modules.moviepilot.status).toBe('configured');
    expect(fullStatus.modules.devices.status).toBe('configured');
    expect(fullStatus.modules.windows.status).toBe('configured');
    expect(fullStatus.modules.vps.status).toBe('configured');

    const serialized = JSON.stringify(fullStatus);
    expect(serialized).not.toContain(BASE_ENV.ADMIN_PASSWORD_HASH);
    expect(serialized).not.toContain(BASE_ENV.SESSION_SECRET);
    expect(serialized).not.toContain('fake-qbit-password-999');
    expect(serialized).not.toContain('fake-mp-token-888');
    expect(serialized).not.toContain('192.0.2.10');
    expect(serialized).not.toContain('mp.example.com');
  });

  it('getConfigStatus 对部分填写的环境变量返回配置不完整且不含值', () => {
    const partialStatus = getConfigStatus({
      ...BASE_ENV,
      NAS_SSH_HOST: '192.0.2.10',
      QBIT_PASSWORD: 'fake-qbit-password-999',
    });

    expect(partialStatus.modules.nas.status).toBe('incomplete');
    expect(partialStatus.modules.nas.statusLabel).toBe('配置不完整');
    expect(partialStatus.modules.nas.keys).toEqual({
      NAS_SSH_HOST: true,
      NAS_SSH_PORT: false,
      NAS_SSH_USER: false,
      NAS_SSH_KEY_PATH: false,
      NAS_MOCK: false,
      NAS_CACHE_SECONDS: false,
    });
    expect(partialStatus.modules.qbittorrent.status).toBe('incomplete');
    expect(partialStatus.modules.qbittorrent.keys.QBIT_PASSWORD).toBe(true);
    expect(JSON.stringify(partialStatus)).not.toContain('fake-qbit-password-999');
    expect(JSON.stringify(partialStatus)).not.toContain('192.0.2.10');
  });

  it('支持 TZ_DISPLAY、VPS_READONLY、WIN_SSH_TIMEOUT_MS、WIN_CACHE_SECONDS 及 WIN_MOCK=true', () => {
    const mockConfig = parseConfig({
      ...BASE_ENV,
      TZ_DISPLAY: 'UTC',
      WIN_MOCK: 'true',
      WIN_SSH_TIMEOUT_MS: '5000',
      WIN_CACHE_SECONDS: '0',
      VPS_LIST_FILE: './secrets/vps.json',
      VPS_READONLY: 'true',
    });

    expect(mockConfig.app.TZ_DISPLAY).toBe('UTC');
    expect(mockConfig.windows).toEqual({
      WIN_MOCK: true,
      WIN_SSH_TIMEOUT_MS: 5000,
      WIN_CACHE_SECONDS: 0,
    });
    expect(mockConfig.vps).toEqual({
      VPS_LIST_FILE: './secrets/vps.json',
      VPS_READONLY: true,
    });

    const status = getConfigStatus(mockConfig);
    expect(status.modules.windows.status).toBe('configured');
    expect(status.modules.windows.keys.WIN_MOCK).toBe(true);
    expect(status.modules.vps.status).toBe('configured');
    expect(status.modules.vps.keys.VPS_READONLY).toBe(true);

    expect(() =>
      parseConfig({
        ...BASE_ENV,
        TZ_DISPLAY: 'Invalid/Timezone',
        WIN_SSH_TIMEOUT_MS: '0',
      }),
    ).toThrow(ConfigError);
  });
});

describe('敏感键管理与日志脱敏工具', () => {
  it('集中识别敏感键名', () => {
    for (const key of SENSITIVE_CONFIG_KEYS) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    expect(isSensitiveKey('CUSTOM_API_TOKEN')).toBe(true);
    expect(isSensitiveKey('SSH_PRIVATE_KEY')).toBe(true);
    expect(isSensitiveKey('PORT')).toBe(false);
    expect(isSensitiveKey('HOST')).toBe(false);
  });

  it('对文本和嵌套对象中的敏感字段及密钥值进行脱敏', () => {
    const config = parseConfig({
      ...BASE_ENV,
      QBIT_URL: 'http://192.0.2.10:8080',
      QBIT_USERNAME: 'qbituser',
      QBIT_PASSWORD: 'fake-qbit-password-999',
      MOVIEPILOT_URL: 'https://mp.example.com',
      MOVIEPILOT_API_TOKEN: 'fake-mp-token-888',
    });
    const secrets = collectSecretValues(config);

    const text = `连接失败 token=fake-inline-token Authorization: Bearer fake-bearer-token secret=${BASE_ENV.SESSION_SECRET} hash=${BASE_ENV.ADMIN_PASSWORD_HASH}`;
    const sanitizedText = redactText(text, secrets);
    expect(sanitizedText).not.toContain('fake-inline-token');
    expect(sanitizedText).not.toContain('fake-bearer-token');
    expect(sanitizedText).not.toContain(BASE_ENV.SESSION_SECRET);
    expect(sanitizedText).not.toContain(BASE_ENV.ADMIN_PASSWORD_HASH);
    expect(sanitizedText).toContain(REDACTED);

    const circular: Record<string, unknown> = {
      host: '192.0.2.10',
      nested: {
        QBIT_PASSWORD: 'fake-qbit-password-999',
        apiToken: 'fake-nested-token',
        note: `包含 ${BASE_ENV.SESSION_SECRET}`,
      },
      err: new Error(`请求失败：${BASE_ENV.SESSION_SECRET}`),
    };
    circular.self = circular;

    const sanitizedObj = redactValue(circular, secrets) as Record<string, unknown>;
    expect(sanitizedObj.host).toBe('192.0.2.10');
    expect(sanitizedObj.self).toBe('[Circular]');
    expect(sanitizedObj.nested).toEqual({
      QBIT_PASSWORD: REDACTED,
      apiToken: REDACTED,
      note: `包含 ${REDACTED}`,
    });
    expect(JSON.stringify(sanitizedObj)).not.toContain(BASE_ENV.SESSION_SECRET);
    expect(JSON.stringify(sanitizedObj)).not.toContain('fake-qbit-password-999');

    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = createSafeLogger(secrets);
      logger.error('鉴权异常', { SESSION_SECRET: BASE_ENV.SESSION_SECRET });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(BASE_ENV.SESSION_SECRET);
    } finally {
      logSpy.mockRestore();
    }
  });
});
