import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, SafeLogger } from '../config/index.js';
import { classifyDeviceError } from '../devices/service.js';
import {
  executeSshCommand,
  type SshCommandExecutor,
  type SshExecResult,
} from '../devices/ssh-executor.js';
import { resolveRepoRelativePath } from '../devices/store.js';
import type { IntegrationsStore } from '../integrations/index.js';
import { createMockNasStatus, type NasService } from './service.js';
import type {
  DockerAction,
  DockerActionResponse,
  DockerAuditEntry,
  DockerAuditResponse,
  DockerLogsResponse,
} from './types.js';

export const DOCKER_CONTAINER_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
export const DOCKER_ALLOWED_ACTIONS = ['start', 'stop', 'restart'] as const;
export const DOCKER_LIST_NAMES_COMMAND = "docker ps -a --format '{{.Names}}'";

const DEFAULT_SSH_TIMEOUT_MS = 8000;
export const DEFAULT_DOCKER_ACTION_TIMEOUT_MS = 60_000;
export const DEFAULT_DOCKER_STOP_TIMEOUT_SECONDS = 30;
export const DOCKER_ACTION_TIMEOUT_MESSAGE = '操作已发出但等待超时，请稍后刷新查看容器状态';

const DOCKER_ACTION_LABELS: Record<DockerAction, string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
};

export function isValidDockerContainerName(name: string): boolean {
  return DOCKER_CONTAINER_NAME_REGEX.test(name);
}

export function isAllowedDockerAction(action: string): action is DockerAction {
  return action === 'start' || action === 'stop' || action === 'restart';
}

/**
 * 计算 docker stop/restart 的优雅退出等待秒数：默认 30 秒，若操作超时配置小于 35000ms 则预留 5 秒余量。
 */
export function resolveDockerStopTimeoutSeconds(
  actionTimeoutMs: number = DEFAULT_DOCKER_ACTION_TIMEOUT_MS,
): number {
  if (!Number.isFinite(actionTimeoutMs)) {
    return DEFAULT_DOCKER_STOP_TIMEOUT_SECONDS;
  }
  if (actionTimeoutMs < 35_000) {
    return Math.max(1, Math.floor(actionTimeoutMs / 1000) - 5);
  }
  return DEFAULT_DOCKER_STOP_TIMEOUT_SECONDS;
}

/**
 * 使用固定模板拼接 Docker 容器操作命令（仅允许 start|stop|restart，且对容器名做严格字符白名单校验）。
 */
export function buildDockerActionCommand(
  action: DockerAction,
  name: string,
  actionTimeoutMs: number = DEFAULT_DOCKER_ACTION_TIMEOUT_MS,
): string {
  if (!isAllowedDockerAction(action)) {
    throw new Error(`不允许的 Docker 操作：${action}`);
  }
  if (!isValidDockerContainerName(name)) {
    throw new Error('容器名称格式无效');
  }
  if (action === 'start') {
    return `docker start -- '${name}'`;
  }
  const waitSeconds = resolveDockerStopTimeoutSeconds(actionTimeoutMs);
  return `docker ${action} -t ${waitSeconds} -- '${name}'`;
}

/**
 * 使用固定模板拼接 Docker 日志读取命令（tail 必须为 1..1000 整数，容器名经严格白名单校验）。
 */
export function buildDockerLogsCommand(name: string, tail: number): string {
  if (!isValidDockerContainerName(name)) {
    throw new Error('容器名称格式无效');
  }
  if (!Number.isInteger(tail) || tail < 1 || tail > 1000) {
    throw new Error('tail 参数必须是 1 到 1000 之间的整数');
  }
  return `docker logs --tail ${tail} --timestamps -- '${name}'`;
}

export function parseDockerPsNames(stdout: string): Set<string> {
  const names = new Set<string>();
  for (const rawLine of stdout.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim().replace(/^\//, '');
    if (line && isValidDockerContainerName(line)) {
      names.add(line);
    }
  }
  return names;
}

export function appendDockerAuditEntry(auditFilePath: string, entry: DockerAuditEntry): void {
  const dir = path.dirname(auditFilePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(auditFilePath, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function readDockerAuditEntries(auditFilePath: string, limit = 50): DockerAuditResponse {
  if (!fs.existsSync(auditFilePath)) {
    return { entries: [], total: 0 };
  }

  let rawText: string;
  try {
    rawText = fs.readFileSync(auditFilePath, 'utf-8');
  } catch {
    return { entries: [], total: 0 };
  }

  const allEntries: DockerAuditEntry[] = [];
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Partial<DockerAuditEntry>;
      if (
        typeof parsed.timestamp === 'string' &&
        typeof parsed.username === 'string' &&
        typeof parsed.container === 'string' &&
        typeof parsed.action === 'string' &&
        (parsed.result === 'success' || parsed.result === 'rejected' || parsed.result === 'failed')
      ) {
        allEntries.push({
          timestamp: parsed.timestamp,
          username: parsed.username,
          clientIp: typeof parsed.clientIp === 'string' ? parsed.clientIp : 'unknown',
          container: parsed.container,
          action: parsed.action,
          result: parsed.result,
          durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
          ...(typeof parsed.error === 'string' && parsed.error ? { error: parsed.error } : {}),
        });
      }
    } catch {
      // 忽略损坏单行
    }
  }

  const newestFirst = [...allEntries].reverse();
  return {
    entries: newestFirst.slice(0, limit),
    total: allEntries.length,
  };
}

export interface CreateNasDockerServiceOptions {
  executor?: SshCommandExecutor;
  readPrivateKey?: (keyPath: string) => Promise<string | Buffer>;
  now?: () => number;
  logger?: SafeLogger;
  timeoutMs?: number;
  actionTimeoutMs?: number;
}

export type DockerActionServiceResult =
  | { ok: true; status: 200; data: DockerActionResponse }
  | { ok: false; status: 400 | 403 | 404 | 500 | 502 | 504; error: string };

export type DockerLogsServiceResult =
  | { ok: true; status: 200; data: DockerLogsResponse }
  | { ok: false; status: 400 | 404 | 500 | 502; error: string };

export interface NasDockerService {
  executeAction: (params: {
    name: string;
    action: string;
    username: string;
    clientIp: string;
  }) => Promise<DockerActionServiceResult>;
  getLogs: (params: { name: string; tailRaw?: string }) => Promise<DockerLogsServiceResult>;
  getAudit: (
    limitRaw?: string,
  ) => { ok: true; data: DockerAuditResponse } | { ok: false; status: 400; error: string };
}

async function defaultReadPrivateKey(keyPath: string): Promise<string> {
  const resolved = resolveRepoRelativePath(keyPath);
  return fs.promises.readFile(resolved, 'utf-8');
}

/**
 * 创建 NAS Docker 容器受限操作、只读日志与 JSONL 审计日志服务。
 */
export function createNasDockerService(
  config: AppConfig,
  integrationsStore: IntegrationsStore,
  nasService: NasService,
  options?: CreateNasDockerServiceOptions,
): NasDockerService {
  const executor = options?.executor ?? executeSshCommand;
  const readPrivateKey = options?.readPrivateKey ?? defaultReadPrivateKey;
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;
  const timeoutMs =
    options?.timeoutMs ?? config.devices?.DEVICE_SSH_TIMEOUT_MS ?? DEFAULT_SSH_TIMEOUT_MS;
  const actionTimeoutMs =
    options?.actionTimeoutMs ??
    config.nas?.DOCKER_ACTION_TIMEOUT_MS ??
    DEFAULT_DOCKER_ACTION_TIMEOUT_MS;

  function getAuditFilePath(): string {
    const configured = config.nas?.DOCKER_AUDIT_FILE ?? './data/docker-audit.log';
    return resolveRepoRelativePath(configured);
  }

  function recordAudit(entry: Omit<DockerAuditEntry, 'timestamp'>): void {
    const fullEntry: DockerAuditEntry = {
      timestamp: new Date(getNow()).toISOString(),
      ...entry,
    };
    try {
      appendDockerAuditEntry(getAuditFilePath(), fullEntry);
    } catch {
      logger?.warn('写入 Docker 操作审计日志失败，请检查目录权限');
    }
  }

  return {
    async executeAction(params): Promise<DockerActionServiceResult> {
      const startedAt = getNow();
      const { name, action, username, clientIp } = params;

      const failAndAudit = (
        status: 400 | 403 | 404 | 500 | 502 | 504,
        result: 'rejected' | 'failed',
        errorMessage: string,
        auditError: string = errorMessage,
      ): DockerActionServiceResult => {
        recordAudit({
          username,
          clientIp,
          container: name,
          action,
          result,
          durationMs: Math.max(0, getNow() - startedAt),
          error: auditError,
        });
        return { ok: false, status, error: errorMessage };
      };

      if (!isAllowedDockerAction(action)) {
        return failAndAudit(400, 'rejected', `不支持的容器操作：${action}`);
      }

      if (!isValidDockerContainerName(name)) {
        return failAndAudit(
          400,
          'rejected',
          '容器名称格式无效，仅允许字母、数字、下划线、点与连字符',
        );
      }

      const actionsEnabled = Boolean(config.nas?.DOCKER_ACTIONS_ENABLED);
      if (!actionsEnabled) {
        return failAndAudit(403, 'rejected', 'Docker 操作未开启');
      }

      const protectedContainers = new Set(integrationsStore.getProtectedDockerContainers());
      if ((action === 'stop' || action === 'restart') && protectedContainers.has(name)) {
        return failAndAudit(403, 'rejected', '受保护容器不允许停止或重启');
      }

      const resolvedNas = integrationsStore.resolveNasConfig();
      if (resolvedNas.mock) {
        const mockDocker = createMockNasStatus(getNow(), { dockerAvailable: true }).docker;
        if (!mockDocker.containers.some((c) => c.name === name)) {
          return failAndAudit(404, 'rejected', '未找到指定容器');
        }
        nasService.invalidateCache();
        const durationMs = Math.max(0, getNow() - startedAt);
        recordAudit({
          username,
          clientIp,
          container: name,
          action,
          result: 'success',
          durationMs,
        });
        return {
          ok: true,
          status: 200,
          data: {
            ok: true,
            container: name,
            action,
            message: `已执行容器 ${name} 的${DOCKER_ACTION_LABELS[action]}操作（模拟）`,
            durationMs,
          },
        };
      }

      if (
        !resolvedNas.configured ||
        !resolvedNas.host ||
        !resolvedNas.port ||
        !resolvedNas.user ||
        !resolvedNas.keyPath
      ) {
        return failAndAudit(400, 'rejected', '尚未配置 NAS 连接参数，无法执行 Docker 操作');
      }

      let privateKey: string | Buffer;
      try {
        privateKey = await readPrivateKey(resolvedNas.keyPath);
      } catch {
        return failAndAudit(500, 'failed', 'SSH 密钥文件不存在或不可读，请检查密钥路径配置');
      }

      try {
        // 操作前实时执行 docker ps -a 验证容器存在，绝不使用缓存
        const psResult = await executor({
          host: resolvedNas.host,
          port: resolvedNas.port,
          username: resolvedNas.user,
          privateKey,
          command: DOCKER_LIST_NAMES_COMMAND,
          timeoutMs,
        });

        if (psResult.code !== 0) {
          return failAndAudit(502, 'failed', '获取 Docker 容器列表失败，请检查 Docker 权限');
        }

        const existingNames = parseDockerPsNames(psResult.stdout);
        if (!existingNames.has(name)) {
          return failAndAudit(404, 'rejected', '未找到指定容器');
        }

        const actionCommand = buildDockerActionCommand(action, name, actionTimeoutMs);
        let actionResult: SshExecResult;
        try {
          actionResult = await executor({
            host: resolvedNas.host,
            port: resolvedNas.port,
            username: resolvedNas.user,
            privateKey,
            command: actionCommand,
            timeoutMs: actionTimeoutMs,
          });
        } catch (actionError) {
          const classified = classifyDeviceError(actionError);
          if (classified.errorCode === 'TIMEOUT') {
            nasService.invalidateCache();
            return failAndAudit(
              504,
              'failed',
              DOCKER_ACTION_TIMEOUT_MESSAGE,
              `${DOCKER_ACTION_TIMEOUT_MESSAGE}（timeout）`,
            );
          }
          return failAndAudit(502, 'failed', classified.error);
        }

        if (actionResult.code !== 0) {
          const stderrSummary = actionResult.stderr.trim().split(/\r?\n/)[0]?.trim();
          return failAndAudit(
            502,
            'failed',
            stderrSummary
              ? `容器${DOCKER_ACTION_LABELS[action]}失败：${stderrSummary}`
              : `容器${DOCKER_ACTION_LABELS[action]}失败（退出码 ${actionResult.code ?? '未知'}）`,
          );
        }

        nasService.invalidateCache();
        const durationMs = Math.max(0, getNow() - startedAt);
        recordAudit({
          username,
          clientIp,
          container: name,
          action,
          result: 'success',
          durationMs,
        });
        return {
          ok: true,
          status: 200,
          data: {
            ok: true,
            container: name,
            action,
            message: `容器 ${name} ${DOCKER_ACTION_LABELS[action]}成功`,
            durationMs,
          },
        };
      } catch (error) {
        const classified = classifyDeviceError(error);
        return failAndAudit(502, 'failed', classified.error);
      }
    },

    async getLogs(params): Promise<DockerLogsServiceResult> {
      const { name, tailRaw } = params;
      if (!isValidDockerContainerName(name)) {
        return {
          ok: false,
          status: 400,
          error: '容器名称格式无效，仅允许字母、数字、下划线、点与连字符',
        };
      }

      let tail = 200;
      if (tailRaw !== undefined) {
        const trimmed = tailRaw.trim();
        if (!/^\d+$/.test(trimmed)) {
          return { ok: false, status: 400, error: 'tail 参数必须是 1 到 1000 之间的整数' };
        }
        const parsedTail = Number(trimmed);
        if (!Number.isInteger(parsedTail) || parsedTail < 1 || parsedTail > 1000) {
          return { ok: false, status: 400, error: 'tail 参数必须是 1 到 1000 之间的整数' };
        }
        tail = parsedTail;
      }

      const resolvedNas = integrationsStore.resolveNasConfig();
      if (resolvedNas.mock) {
        const mockDocker = createMockNasStatus(getNow(), { dockerAvailable: true }).docker;
        if (!mockDocker.containers.some((c) => c.name === name)) {
          return { ok: false, status: 404, error: '未找到指定容器' };
        }
        const fetchedAt = new Date(getNow()).toISOString();
        return {
          ok: true,
          status: 200,
          data: {
            container: name,
            tail,
            logs: `${fetchedAt} [mock] container ${name} running normally (tail=${tail})`,
            fetchedAt,
          },
        };
      }

      if (
        !resolvedNas.configured ||
        !resolvedNas.host ||
        !resolvedNas.port ||
        !resolvedNas.user ||
        !resolvedNas.keyPath
      ) {
        return { ok: false, status: 400, error: '尚未配置 NAS 连接参数，无法查看容器日志' };
      }

      let privateKey: string | Buffer;
      try {
        privateKey = await readPrivateKey(resolvedNas.keyPath);
      } catch {
        return { ok: false, status: 500, error: 'SSH 密钥文件不存在或不可读，请检查密钥路径配置' };
      }

      try {
        const psResult = await executor({
          host: resolvedNas.host,
          port: resolvedNas.port,
          username: resolvedNas.user,
          privateKey,
          command: DOCKER_LIST_NAMES_COMMAND,
          timeoutMs,
        });

        if (psResult.code !== 0) {
          return { ok: false, status: 502, error: '获取 Docker 容器列表失败，请检查 Docker 权限' };
        }

        const existingNames = parseDockerPsNames(psResult.stdout);
        if (!existingNames.has(name)) {
          return { ok: false, status: 404, error: '未找到指定容器' };
        }

        const logsCommand = buildDockerLogsCommand(name, tail);
        const logsResult = await executor({
          host: resolvedNas.host,
          port: resolvedNas.port,
          username: resolvedNas.user,
          privateKey,
          command: logsCommand,
          timeoutMs,
        });

        if (logsResult.code !== 0) {
          const stderrSummary = logsResult.stderr.trim().split(/\r?\n/)[0]?.trim();
          return {
            ok: false,
            status: 502,
            error: stderrSummary
              ? `获取容器日志失败：${stderrSummary}`
              : `获取容器日志失败（退出码 ${logsResult.code ?? '未知'}）`,
          };
        }

        const combined = [logsResult.stdout.trimEnd(), logsResult.stderr.trimEnd()]
          .filter((part) => part.length > 0)
          .join('\n');

        return {
          ok: true,
          status: 200,
          data: {
            container: name,
            tail,
            logs: combined,
            fetchedAt: new Date(getNow()).toISOString(),
          },
        };
      } catch (error) {
        const classified = classifyDeviceError(error);
        return { ok: false, status: 502, error: classified.error };
      }
    },

    getAudit(limitRaw) {
      let limit = 50;
      if (limitRaw !== undefined) {
        const trimmed = limitRaw.trim();
        if (!/^\d+$/.test(trimmed)) {
          return { ok: false, status: 400, error: 'limit 参数必须是 1 到 500 之间的整数' };
        }
        const parsedLimit = Number(trimmed);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
          return { ok: false, status: 400, error: 'limit 参数必须是 1 到 500 之间的整数' };
        }
        limit = parsedLimit;
      }

      return {
        ok: true,
        data: readDockerAuditEntries(getAuditFilePath(), limit),
      };
    },
  };
}
