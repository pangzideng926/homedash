import { z } from 'zod';
import type { SafeLogger } from '../config/index.js';
import type { IntegrationsStore, ResolvedDownloaderInstance } from '../integrations/index.js';
import { createQbitClient, QbitClientError, type QbitClientConfig } from '../qbittorrent/client.js';
import {
  buildQbitInstanceSummary,
  buildTransmissionInstanceSummary,
  clampActiveLimit,
  computeDownloadersTotals,
  createEmptyStateCounts,
  createMockDownloaderSummaries,
  createMockQbitTorrents,
  MAX_ACTIVE_TASKS_LIMIT,
} from './aggregators.js';
import {
  createTransmissionClient,
  TransmissionClientError,
  type TransmissionClientConfig,
} from './transmission-client.js';
import type {
  DownloaderErrorCode,
  DownloaderInstanceSummary,
  DownloadersSummaryResponse,
  DownloaderTestResponse,
} from './types.js';

const FAILURE_CACHE_MS = 10_000;

function isValidHttpUrl(val: string): boolean {
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const downloaderTestSchema = z.object({
  id: z.string().trim().optional(),
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
  password: z.preprocess(
    (val) => (val === undefined || val === null ? '' : val),
    z.string({ message: '密码必须是字符串' }),
  ),
});

export interface CreateDownloadersServiceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  logger?: SafeLogger;
}

export interface DownloadersService {
  getAllSummaries: (options?: { refresh?: boolean }) => Promise<DownloadersSummaryResponse>;
  getInstanceSummary: (
    id: string,
    options?: { refresh?: boolean; activeLimit?: number },
  ) => Promise<{ found: false } | { found: true; data: DownloaderInstanceSummary }>;
  getInstanceTorrents: (
    id: string,
    options?: { refresh?: boolean },
  ) => Promise<
    | { ok: true; instanceName: string; torrents: Array<Record<string, unknown>> }
    | { ok: false; instanceName: string; error: string }
  >;
  testConnection: (
    rawBody: unknown,
  ) => Promise<
    { ok: true; data: DownloaderTestResponse } | { ok: false; status: 400; error: string }
  >;
  invalidateCache: () => void;
}

interface CacheEntry {
  expiresAtMs: number;
  summary: DownloaderInstanceSummary;
}

type InstanceTorrentsResult =
  | { ok: true; instanceName: string; torrents: Array<Record<string, unknown>> }
  | { ok: false; instanceName: string; error: string };

interface TorrentsCacheEntry {
  expiresAtMs: number;
  result: InstanceTorrentsResult;
}

/**
 * 创建多实例下载器只读采集服务（支持 qBittorrent + Transmission、按实例缓存与并发采集）。
 */
export function createDownloadersService(
  integrationsStore: IntegrationsStore,
  options?: CreateDownloadersServiceOptions,
): DownloadersService {
  const fetchFn = options?.fetchFn ?? fetch;
  const qbitClient = createQbitClient(fetchFn);
  const transmissionClient = createTransmissionClient(fetchFn);
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;

  const instanceCache = new Map<string, CacheEntry>();
  const inFlightById = new Map<string, Promise<DownloaderInstanceSummary>>();
  const torrentsCache = new Map<string, TorrentsCacheEntry>();
  const inFlightTorrentsById = new Map<string, Promise<InstanceTorrentsResult>>();

  function buildErrorSummary(
    instance: ResolvedDownloaderInstance,
    checkedAt: string,
    errorCode: DownloaderErrorCode,
    error: string,
  ): DownloaderInstanceSummary {
    return {
      id: instance.id,
      name: instance.name,
      type: instance.type,
      tags: [...instance.tags],
      online: false,
      checkedAt,
      cached: false,
      errorCode,
      error,
      version: '',
      upSpeed: 0,
      dlSpeed: 0,
      counts: createEmptyStateCounts(),
      totalSize: 0,
      byTracker: [],
      ...(instance.type === 'qbittorrent' ? { byCategory: [] } : { byLabel: [] }),
      problems: [],
      problemsTotal: 0,
      activeTasks: [],
      activeTotal: 0,
    };
  }

  function applyActiveLimit(
    summary: DownloaderInstanceSummary,
    activeLimit: number,
  ): DownloaderInstanceSummary {
    const effective = clampActiveLimit(activeLimit);
    return {
      ...summary,
      activeTasks: summary.activeTasks.slice(0, effective),
    };
  }

  async function collectInstanceOnce(
    instance: ResolvedDownloaderInstance,
    cacheSeconds: number,
    timeoutMs: number,
  ): Promise<DownloaderInstanceSummary> {
    if (!instance.url) {
      const checkedAt = new Date(getNow()).toISOString();
      return buildErrorSummary(
        instance,
        checkedAt,
        'UNCONFIGURED',
        `下载器 ${instance.name} 缺少服务地址配置`,
      );
    }

    if (instance.type === 'qbittorrent') {
      if (!instance.username || !instance.password) {
        const checkedAt = new Date(getNow()).toISOString();
        return buildErrorSummary(
          instance,
          checkedAt,
          'UNCONFIGURED',
          `qBittorrent 实例 ${instance.name} 缺少用户名或密码`,
        );
      }

      const cfg: QbitClientConfig = {
        instanceId: instance.id,
        url: instance.url,
        username: instance.username,
        password: instance.password,
        timeoutMs,
      };

      try {
        const [version, transferInfo, maindata, torrents, categories] = await Promise.all([
          qbitClient.getVersion(cfg),
          qbitClient.getTransferInfo(cfg),
          qbitClient.getMaindata(cfg),
          qbitClient.getTorrentsInfo(cfg),
          qbitClient.getCategories(cfg),
        ]);

        const finishedAt = getNow();
        const summary = buildQbitInstanceSummary({
          instance,
          checkedAt: new Date(finishedAt).toISOString(),
          cached: false,
          version,
          transferInfo,
          maindata,
          torrents,
          categories,
          activeLimit: MAX_ACTIVE_TASKS_LIMIT,
        });

        const cacheTtlMs = cacheSeconds * 1000;
        if (cacheTtlMs > 0) {
          instanceCache.set(instance.id, { expiresAtMs: finishedAt + cacheTtlMs, summary });
        } else {
          instanceCache.delete(instance.id);
        }
        return summary;
      } catch (error) {
        const finishedAt = getNow();
        const qbitErr =
          error instanceof QbitClientError
            ? error
            : new QbitClientError('CONNECTION_FAILED', '获取 qBittorrent 数据失败');
        const failure = buildErrorSummary(
          instance,
          new Date(finishedAt).toISOString(),
          qbitErr.code,
          qbitErr.message,
        );
        instanceCache.set(instance.id, {
          expiresAtMs: finishedAt + FAILURE_CACHE_MS,
          summary: failure,
        });
        logger?.warn(`下载器 [${instance.name}] 采集失败（${qbitErr.code}）：${qbitErr.message}`);
        return failure;
      }
    }

    const trCfg: TransmissionClientConfig = {
      instanceId: instance.id,
      url: instance.url,
      username: instance.username,
      ...(instance.password !== undefined ? { password: instance.password } : {}),
      timeoutMs,
    };

    try {
      const [session, stats, torrents] = await Promise.all([
        transmissionClient.getSession(trCfg),
        transmissionClient.getSessionStats(trCfg),
        transmissionClient.getTorrents(trCfg),
      ]);

      const finishedAt = getNow();
      const summary = buildTransmissionInstanceSummary({
        instance,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        session,
        stats,
        torrents,
        activeLimit: MAX_ACTIVE_TASKS_LIMIT,
      });

      const cacheTtlMs = cacheSeconds * 1000;
      if (cacheTtlMs > 0) {
        instanceCache.set(instance.id, { expiresAtMs: finishedAt + cacheTtlMs, summary });
      } else {
        instanceCache.delete(instance.id);
      }
      return summary;
    } catch (error) {
      const finishedAt = getNow();
      const trErr =
        error instanceof TransmissionClientError
          ? error
          : new TransmissionClientError('CONNECTION_FAILED', '获取 Transmission 数据失败');
      const failure = buildErrorSummary(
        instance,
        new Date(finishedAt).toISOString(),
        trErr.code,
        trErr.message,
      );
      instanceCache.set(instance.id, {
        expiresAtMs: finishedAt + FAILURE_CACHE_MS,
        summary: failure,
      });
      logger?.warn(`下载器 [${instance.name}] 采集失败（${trErr.code}）：${trErr.message}`);
      return failure;
    }
  }

  async function getSingleSummary(
    instance: ResolvedDownloaderInstance,
    cacheSeconds: number,
    timeoutMs: number,
    refresh: boolean,
  ): Promise<DownloaderInstanceSummary> {
    const nowMs = getNow();
    if (!refresh) {
      const cached = instanceCache.get(instance.id);
      if (cached && nowMs < cached.expiresAtMs) {
        return {
          ...cached.summary,
          // 确保编辑名称/标签后即使命中缓存也能体现当前实例元信息
          name: instance.name,
          tags: [...instance.tags],
          cached: true,
        };
      }
    }

    const existing = inFlightById.get(instance.id);
    if (existing) {
      return existing;
    }

    const promise = collectInstanceOnce(instance, cacheSeconds, timeoutMs).finally(() => {
      inFlightById.delete(instance.id);
    });
    inFlightById.set(instance.id, promise);
    return promise;
  }

  return {
    async getAllSummaries(reqOptions?: { refresh?: boolean }): Promise<DownloadersSummaryResponse> {
      const resolved = integrationsStore.resolveDownloadersConfig();
      const nowMs = getNow();
      const checkedAt = new Date(nowMs).toISOString();

      if (resolved.mock) {
        const mockInstances = createMockDownloaderSummaries(nowMs, resolved.activeTasksLimit);
        return {
          configured: true,
          mock: true,
          checkedAt,
          instances: mockInstances,
          totals: computeDownloadersTotals(mockInstances),
        };
      }

      const enabledInstances = resolved.instances.filter((item) => item.enabled);
      if (enabledInstances.length === 0) {
        return {
          configured: resolved.configured,
          mock: false,
          checkedAt,
          instances: [],
          totals: computeDownloadersTotals([]),
        };
      }

      const refresh = Boolean(reqOptions?.refresh);
      const rawInstances = await Promise.all(
        enabledInstances.map((inst) =>
          getSingleSummary(inst, resolved.cacheSeconds, resolved.timeoutMs, refresh),
        ),
      );
      const instances = rawInstances.map((inst) =>
        applyActiveLimit(inst, resolved.activeTasksLimit),
      );

      return {
        configured: true,
        mock: false,
        checkedAt: new Date(getNow()).toISOString(),
        instances,
        totals: computeDownloadersTotals(instances),
      };
    },

    async getInstanceSummary(
      id: string,
      reqOptions?: { refresh?: boolean; activeLimit?: number },
    ): Promise<{ found: false } | { found: true; data: DownloaderInstanceSummary }> {
      const resolved = integrationsStore.resolveDownloadersConfig();
      const nowMs = getNow();
      const effectiveLimit = clampActiveLimit(reqOptions?.activeLimit ?? resolved.activeTasksLimit);

      if (resolved.mock) {
        const mockInstances = createMockDownloaderSummaries(nowMs, effectiveLimit);
        const foundMock = mockInstances.find((item) => item.id === id);
        if (!foundMock) {
          return { found: false };
        }
        return { found: true, data: foundMock };
      }

      const instance = resolved.instances.find((item) => item.id === id);
      if (!instance) {
        return { found: false };
      }

      const summary = await getSingleSummary(
        instance,
        resolved.cacheSeconds,
        resolved.timeoutMs,
        Boolean(reqOptions?.refresh),
      );
      return { found: true, data: applyActiveLimit(summary, effectiveLimit) };
    },

    async getInstanceTorrents(
      id: string,
      reqOptions?: { refresh?: boolean },
    ): Promise<InstanceTorrentsResult> {
      const resolved = integrationsStore.resolveDownloadersConfig();
      if (resolved.mock) {
        const mockSummary = createMockDownloaderSummaries(getNow(), resolved.activeTasksLimit).find(
          (item) => item.id === id,
        );
        if (!mockSummary) {
          return { ok: false, instanceName: id, error: '未找到指定下载器实例' };
        }
        return {
          ok: true,
          instanceName: mockSummary.name,
          torrents: createMockQbitTorrents(id),
        };
      }

      const instance = resolved.instances.find((item) => item.id === id);
      if (!instance) {
        return { ok: false, instanceName: id, error: '未找到指定下载器实例' };
      }

      if (instance.type !== 'qbittorrent') {
        return {
          ok: false,
          instanceName: instance.name,
          error: `下载器 ${instance.name} 不是 qBittorrent 实例`,
        };
      }

      if (!instance.url || !instance.username || !instance.password) {
        return {
          ok: false,
          instanceName: instance.name,
          error: `qBittorrent 实例 ${instance.name} 缺少连接凭据配置`,
        };
      }

      const refresh = Boolean(reqOptions?.refresh);
      const nowMs = getNow();
      if (!refresh) {
        const cached = torrentsCache.get(instance.id);
        if (cached && nowMs < cached.expiresAtMs) {
          return cached.result;
        }
      }

      const existing = inFlightTorrentsById.get(instance.id);
      if (existing) {
        return existing;
      }

      const cfg: QbitClientConfig = {
        instanceId: instance.id,
        url: instance.url,
        username: instance.username,
        password: instance.password,
        timeoutMs: resolved.timeoutMs,
      };

      const promise = (async (): Promise<InstanceTorrentsResult> => {
        try {
          const torrents = await qbitClient.getTorrentsInfo(cfg);
          const finishedAt = getNow();
          const success: InstanceTorrentsResult = {
            ok: true,
            instanceName: instance.name,
            torrents,
          };
          const cacheTtlMs = resolved.cacheSeconds * 1000;
          if (cacheTtlMs > 0) {
            torrentsCache.set(instance.id, {
              expiresAtMs: finishedAt + cacheTtlMs,
              result: success,
            });
          } else {
            torrentsCache.delete(instance.id);
          }
          return success;
        } catch (error) {
          const finishedAt = getNow();
          const qbitErr =
            error instanceof QbitClientError
              ? error
              : new QbitClientError('CONNECTION_FAILED', '获取 qBittorrent 种子列表失败');
          const failure: InstanceTorrentsResult = {
            ok: false,
            instanceName: instance.name,
            error: qbitErr.message,
          };
          torrentsCache.set(instance.id, {
            expiresAtMs: finishedAt + FAILURE_CACHE_MS,
            result: failure,
          });
          logger?.warn(
            `下载器 [${instance.name}] 种子采集失败（${qbitErr.code}）：${qbitErr.message}`,
          );
          return failure;
        }
      })().finally(() => {
        inFlightTorrentsById.delete(instance.id);
      });

      inFlightTorrentsById.set(instance.id, promise);
      return promise;
    },

    async testConnection(
      rawBody: unknown,
    ): Promise<
      { ok: true; data: DownloaderTestResponse } | { ok: false; status: 400; error: string }
    > {
      const parsed = downloaderTestSchema.safeParse(rawBody);
      if (!parsed.success) {
        return {
          ok: false,
          status: 400,
          error: parsed.error.issues[0]?.message ?? '连接测试参数无效',
        };
      }

      const input = parsed.data;
      const startedAt = getNow();
      const resolvedConfig = integrationsStore.resolveDownloadersConfig();
      const existing = input.id ? integrationsStore.resolveDownloaderById(input.id) : null;
      const effectivePassword = input.password ? input.password : (existing?.password ?? '');
      const effectiveUsername = input.username || existing?.username || '';

      if (input.type === 'qbittorrent') {
        if (!effectiveUsername || !effectivePassword) {
          return {
            ok: true,
            data: {
              ok: false,
              type: 'qbittorrent',
              durationMs: Math.max(0, getNow() - startedAt),
              error: '请填写完整的 qBittorrent 用户名与密码',
            },
          };
        }

        const tempClient = createQbitClient(fetchFn);
        try {
          const version = await tempClient.getVersion({
            instanceId: input.id ?? 'test',
            url: input.url,
            username: effectiveUsername,
            password: effectivePassword,
            timeoutMs: resolvedConfig.timeoutMs,
          });
          return {
            ok: true,
            data: {
              ok: true,
              type: 'qbittorrent',
              version,
              durationMs: Math.max(0, getNow() - startedAt),
              detail: `qBittorrent 连接成功（版本：${version}）`,
            },
          };
        } catch (error) {
          return {
            ok: true,
            data: {
              ok: false,
              type: 'qbittorrent',
              durationMs: Math.max(0, getNow() - startedAt),
              error: error instanceof QbitClientError ? error.message : 'qBittorrent 连接测试失败',
            },
          };
        }
      }

      const tempTrClient = createTransmissionClient(fetchFn);
      try {
        const session = await tempTrClient.getSession({
          instanceId: input.id ?? 'test',
          url: input.url,
          username: effectiveUsername,
          password: effectivePassword,
          timeoutMs: resolvedConfig.timeoutMs,
        });
        const version =
          typeof session.version === 'string' && session.version.trim()
            ? session.version.trim()
            : '未知版本';
        return {
          ok: true,
          data: {
            ok: true,
            type: 'transmission',
            version,
            durationMs: Math.max(0, getNow() - startedAt),
            detail: `Transmission 连接成功（版本：${version}）`,
          },
        };
      } catch (error) {
        return {
          ok: true,
          data: {
            ok: false,
            type: 'transmission',
            durationMs: Math.max(0, getNow() - startedAt),
            error:
              error instanceof TransmissionClientError
                ? error.message
                : 'Transmission 连接测试失败',
          },
        };
      }
    },

    invalidateCache(): void {
      instanceCache.clear();
      torrentsCache.clear();
      qbitClient.clearSessions();
      transmissionClient.clearSessions();
    },
  };
}
