import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT, type AppConfig } from '../config/index.js';
import type {
  DeviceListResponse,
  DeviceOsConfig,
  DeviceRecord,
  SaveDevicesResult,
} from './types.js';

export const LEGACY_READONLY_REASON =
  '当前来自 WIN_SSH_* 环境变量，配置 DEVICES_FILE 后可在界面编辑';
export const DEVICES_READONLY_REASON =
  '当前处于只读模式（DEVICES_READONLY=true），禁止修改设备列表';
export const MOCK_READONLY_REASON = '当前处于模拟模式（DEVICES_MOCK / WIN_MOCK），暂不支持保存修改';

export const MOCK_DEVICES: readonly DeviceRecord[] = [
  {
    id: 'mock-windows',
    name: 'Windows 主力机（模拟）',
    host: '192.0.2.20',
    port: 22,
    user: 'demo',
    keyPath: './secrets/demo_win_ed25519',
    os: 'windows',
    enabled: true,
    note: '模拟 Windows 设备，用于开发与演示',
  },
  {
    id: 'mock-macos',
    name: 'Mac mini（模拟）',
    host: 'demo-mac.local',
    port: 22,
    user: 'demo',
    keyPath: './secrets/demo_mac_ed25519',
    os: 'macos',
    enabled: true,
    note: '模拟 macOS 设备，用于开发与演示',
  },
];

const deviceOsSchema = z.enum(['auto', 'windows', 'macos', 'linux'], {
  message: '系统类型必须是 auto、windows、macos 或 linux 之一',
});

const devicePortSchema = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? 22 : value),
  z
    .number({ message: '端口必须是整数' })
    .int('端口必须是整数')
    .min(1, '端口必须在 1 到 65535 之间')
    .max(65535, '端口必须在 1 到 65535 之间'),
);

const nullableNoteSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().default(null));

export const deviceItemSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, z.string().optional()),
  name: z.string({ message: '设备名称必须填写' }).trim().min(1, '设备名称不能为空'),
  host: z.string({ message: '主机地址必须填写' }).trim().min(1, '主机地址不能为空'),
  port: devicePortSchema.default(22),
  user: z.string({ message: 'SSH 用户名必须填写' }).trim().min(1, 'SSH 用户名不能为空'),
  keyPath: z.string({ message: '私钥文件路径必须填写' }).trim().min(1, '私钥文件路径不能为空'),
  os: deviceOsSchema.default('auto'),
  enabled: z.boolean({ message: 'enabled 必须是布尔值' }).default(true),
  note: nullableNoteSchema,
});

const devicesFileRootSchema = z.object({
  devices: z.array(z.unknown(), { message: 'devices 必须是数组' }),
});

const devicesPutPayloadSchema = z.object({
  devices: z.array(deviceItemSchema, { message: 'devices 必须是数组' }),
});

export const deviceTestPayloadSchema = z.object({
  name: z.string().trim().optional(),
  host: z.string({ message: '主机地址必须填写' }).trim().min(1, '主机地址不能为空'),
  port: devicePortSchema.default(22),
  user: z.string({ message: 'SSH 用户名必须填写' }).trim().min(1, 'SSH 用户名不能为空'),
  keyPath: z.string({ message: '私钥文件路径必须填写' }).trim().min(1, '私钥文件路径不能为空'),
  os: deviceOsSchema.default('auto'),
});

export interface ParsedDeviceTestPayload {
  name?: string;
  host: string;
  port: number;
  user: string;
  keyPath: string;
  os: DeviceOsConfig;
}

export function resolveRepoRelativePath(configuredPath: string): string {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  const cwdCandidate = path.resolve(process.cwd(), configuredPath);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }
  const repoCandidate = path.resolve(REPO_ROOT, configuredPath);
  if (fs.existsSync(repoCandidate)) {
    return repoCandidate;
  }
  return cwdCandidate;
}

export function isDevicesMockEnabled(config: AppConfig): boolean {
  return Boolean(config.devices?.DEVICES_MOCK || config.windows?.WIN_MOCK);
}

export function hasLegacyWindowsSshConfig(config: AppConfig): boolean {
  return Boolean(
    config.windows?.WIN_SSH_HOST &&
    config.windows.WIN_SSH_PORT &&
    config.windows.WIN_SSH_USER &&
    config.windows.WIN_SSH_KEY_PATH,
  );
}

/**
 * 读取设备清单（支持 DEVICES_FILE、WIN_SSH_* 兼容迁移与模拟开关），绝不读取私钥内容。
 */
export function readDevicesList(config: AppConfig): DeviceListResponse {
  if (isDevicesMockEnabled(config)) {
    return {
      configured: true,
      source: 'mock',
      readonly: true,
      readonlyReason: MOCK_READONLY_REASON,
      devices: MOCK_DEVICES.map((device) => ({ ...device })),
    };
  }

  const configuredFile = config.devices?.DEVICES_FILE;
  if (configuredFile) {
    const readonly = Boolean(config.devices?.DEVICES_READONLY);
    const readonlyProps = readonly ? { readonlyReason: DEVICES_READONLY_REASON } : {};
    const filePath = resolveRepoRelativePath(configuredFile);

    let rawText: string;
    try {
      rawText = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          configured: true,
          source: 'file',
          readonly,
          ...readonlyProps,
          devices: [],
          errorCode: 'FILE_NOT_FOUND',
          error: '设备清单文件不存在，请检查 DEVICES_FILE 配置',
        };
      }
      return {
        configured: true,
        source: 'file',
        readonly,
        ...readonlyProps,
        devices: [],
        errorCode: 'READ_ERROR',
        error: '无法读取设备清单文件，请检查文件权限',
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      return {
        configured: true,
        source: 'file',
        readonly,
        ...readonlyProps,
        devices: [],
        errorCode: 'INVALID_JSON',
        error: '设备清单文件 JSON 解析失败，请检查文件格式',
      };
    }

    const rootResult = devicesFileRootSchema.safeParse(parsedJson);
    if (!rootResult.success) {
      return {
        configured: true,
        source: 'file',
        readonly,
        ...readonlyProps,
        devices: [],
        errorCode: 'INVALID_FORMAT',
        error: '设备清单文件格式错误，根节点需包含 devices 数组',
      };
    }

    const devices: DeviceRecord[] = [];
    for (let i = 0; i < rootResult.data.devices.length; i += 1) {
      const itemResult = deviceItemSchema.safeParse(rootResult.data.devices[i]);
      if (!itemResult.success) {
        const msg = itemResult.error.issues[0]?.message ?? '条目格式错误';
        return {
          configured: true,
          source: 'file',
          readonly,
          ...readonlyProps,
          devices: [],
          errorCode: 'INVALID_FORMAT',
          error: `设备清单第 ${i + 1} 项格式错误：${msg}`,
        };
      }
      const item = itemResult.data;
      devices.push({
        id: item.id ?? `device-${i + 1}`,
        name: item.name,
        host: item.host,
        port: item.port,
        user: item.user,
        keyPath: item.keyPath,
        os: item.os,
        enabled: item.enabled,
        note: item.note ?? null,
      });
    }

    return {
      configured: true,
      source: 'file',
      readonly,
      ...readonlyProps,
      devices,
    };
  }

  if (hasLegacyWindowsSshConfig(config)) {
    const win = config.windows!;
    return {
      configured: true,
      source: 'legacy-windows',
      readonly: true,
      readonlyReason: LEGACY_READONLY_REASON,
      devices: [
        {
          id: 'legacy-windows',
          name: 'Windows 设备',
          host: win.WIN_SSH_HOST!,
          port: win.WIN_SSH_PORT!,
          user: win.WIN_SSH_USER!,
          keyPath: win.WIN_SSH_KEY_PATH!,
          os: 'windows',
          enabled: true,
          note: null,
        },
      ],
    };
  }

  return {
    configured: false,
    source: 'unconfigured',
    readonly: false,
    devices: [],
    errorCode: 'UNCONFIGURED',
    error: '尚未配置家用设备，请配置 DEVICES_FILE 或启用 DEVICES_MOCK=true',
  };
}

/**
 * 校验并原子保存设备清单（写入前生成 .bak 备份，写入临时文件再 rename）。
 */
export function saveDevicesList(config: AppConfig, rawBody: unknown): SaveDevicesResult {
  if (config.devices?.DEVICES_READONLY) {
    return {
      ok: false,
      status: 403,
      error: DEVICES_READONLY_REASON,
    };
  }

  if (isDevicesMockEnabled(config) && !config.devices?.DEVICES_FILE) {
    return {
      ok: false,
      status: 403,
      error: MOCK_READONLY_REASON,
    };
  }

  const configuredFile = config.devices?.DEVICES_FILE;
  if (!configuredFile) {
    if (hasLegacyWindowsSshConfig(config)) {
      return {
        ok: false,
        status: 403,
        error: LEGACY_READONLY_REASON,
      };
    }
    return {
      ok: false,
      status: 400,
      error: '尚未配置设备清单文件（DEVICES_FILE），无法保存',
    };
  }

  const parsed = devicesPutPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const pathText = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
      return `${pathText}${issue.message}`;
    });
    return {
      ok: false,
      status: 400,
      error: `参数校验失败：${details[0] ?? '请检查输入格式'}`,
      details,
    };
  }

  const seenIds = new Set<string>();
  const normalizedDevices: DeviceRecord[] = [];
  for (const item of parsed.data.devices) {
    const id = item.id ?? randomUUID();
    if (seenIds.has(id)) {
      return {
        ok: false,
        status: 400,
        error: `设备 ID 重复：${id}`,
      };
    }
    seenIds.add(id);
    normalizedDevices.push({
      id,
      name: item.name,
      host: item.host,
      port: item.port,
      user: item.user,
      keyPath: item.keyPath,
      os: item.os,
      enabled: item.enabled,
      note: item.note ?? null,
    });
  }

  const targetPath = resolveRepoRelativePath(configuredFile);
  const dir = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  const tempPath = path.join(
    dir,
    `.${baseName}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`,
  );

  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, `${targetPath}.bak`);
    }
    const content = `${JSON.stringify({ devices: normalizedDevices }, null, 2)}\n`;
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, targetPath);
  } catch {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 忽略临时文件清理失败
      }
    }
    return {
      ok: false,
      status: 500,
      error: '写入设备清单文件失败，请检查目录权限',
    };
  }

  return {
    ok: true,
    data: {
      configured: true,
      source: 'file',
      readonly: false,
      devices: normalizedDevices,
    },
  };
}
