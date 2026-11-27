import type { SafeLogger } from '../config/index.js';
import type {
  IntegrationsStore,
  IntegrationTestResponse,
  QbittorrentTestOverride,
} from '../integrations/index.js';
import { createQbitClient, QbitClientError, type QbitClientConfig } from './client.js';
import type {
  QbitGroupStat,
  QbitProblemTorrent,
  QbitStateCounts,
  QbitSummaryData,
  QbitSummaryResponse,
} from './types.js';

const FAILURE_CACHE_MS = 10_000;
const MAX_PROBLEM_TORRENTS = 50;

const SEEDING_STATES = new Set(['uploading', 'stalledUP', 'forcedUP', 'queuedUP', 'checkingUP']);

const DOWNLOADING_STATES = new Set([
  'downloading',
  'forcedDL',
  'metaDL',
  'forcedMetaDL',
  'queuedDL',
  'checkingDL',
  'allocating',
]);

const PAUSED_STATES = new Set(['pausedUP', 'pausedDL', 'stoppedUP', 'stoppedDL']);
const ERROR_STATES = new Set(['error', 'missingFiles']);

/**
 * 从 torrent.tracker 字段安全提取规范化域名（去掉常见 tracker./t./announce. 子域前缀）。
 */
export function extractTrackerDomain(rawTracker: unknown): string {
  if (typeof rawTracker !== 'string' || !rawTracker.trim()) {
    return '无 Tracker';
  }
  const trimmed = rawTracker.trim();
  let hostname = '';
  try {
    hostname = new URL(trimmed).hostname.toLowerCase();
  } catch {
    // 兼容无协议前缀的 host:port/announce 格式
    const stripped = trimmed.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
    hostname = (stripped.split(':')[0] ?? '').toLowerCase();
  }
  if (!hostname) {
    return '无 Tracker';
  }

  const normalized = hostname.replace(/^(tracker\d*|t\d*|announce\d*)\./i, '');
  if (normalized && normalized.includes('.')) {
    return normalized;
  }
  return hostname;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNonEmptyString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function isValidHttpUrl(val: string): boolean {
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 根据 qBittorrent 接口原始数据聚合速度、总量、状态分组、Tracker/分类统计与问题种子列表。
 */
export function buildQbitSummaryData(params: {
  version: string;
  transferInfo: Record<string, unknown>;
  maindata: Record<string, unknown> | null;
  torrents: Array<Record<string, unknown>>;
  categories: Record<string, unknown>;
}): QbitSummaryData {
  const upSpeed = Math.max(0, toFiniteNumber(params.transferInfo.up_info_speed, 0));
  const dlSpeed = Math.max(0, toFiniteNumber(params.transferInfo.dl_info_speed, 0));

  const serverState =
    params.maindata &&
    typeof params.maindata.server_state === 'object' &&
    params.maindata.server_state !== null
      ? (params.maindata.server_state as Record<string, unknown>)
      : null;

  const hasAlltime =
    serverState !== null &&
    serverState.alltime_ul !== undefined &&
    serverState.alltime_dl !== undefined;

  let alltimeUploadBytes = 0;
  let alltimeDownloadBytes = 0;
  let globalRatio = 0;
  let totalsApproximate = false;

  if (hasAlltime && serverState) {
    alltimeUploadBytes = Math.max(0, toFiniteNumber(serverState.alltime_ul, 0));
    alltimeDownloadBytes = Math.max(0, toFiniteNumber(serverState.alltime_dl, 0));
    const parsedRatio = toFiniteNumber(serverState.global_ratio, Number.NaN);
    if (Number.isFinite(parsedRatio) && parsedRatio >= 0) {
      globalRatio = Math.round(parsedRatio * 100) / 100;
    } else if (alltimeDownloadBytes > 0) {
      globalRatio = Math.round((alltimeUploadBytes / alltimeDownloadBytes) * 100) / 100;
    }
  } else {
    totalsApproximate = true;
    for (const t of params.torrents) {
      alltimeUploadBytes += Math.max(0, toFiniteNumber(t.uploaded, 0));
      alltimeDownloadBytes += Math.max(0, toFiniteNumber(t.downloaded, 0));
    }
    if (alltimeDownloadBytes > 0) {
      globalRatio = Math.round((alltimeUploadBytes / alltimeDownloadBytes) * 100) / 100;
    }
  }

  const counts: QbitStateCounts = {
    seeding: 0,
    downloading: 0,
    paused: 0,
    error: 0,
    stalled: 0,
    other: 0,
    total: params.torrents.length,
  };

  const trackerMap = new Map<string, QbitGroupStat>();
  const categoryMap = new Map<string, QbitGroupStat>();
  for (const catKey of Object.keys(params.categories)) {
    const trimmed = catKey.trim();
    if (trimmed) {
      categoryMap.set(trimmed, {
        name: trimmed,
        seedingCount: 0,
        totalCount: 0,
        totalSizeBytes: 0,
      });
    }
  }

  const allProblems: QbitProblemTorrent[] = [];

  for (let i = 0; i < params.torrents.length; i += 1) {
    const t = params.torrents[i]!;
    const hash = toNonEmptyString(t.hash, `torrent-${i + 1}`);
    const name = toNonEmptyString(t.name, '未命名种子');
    const state = toNonEmptyString(t.state, 'unknown');
    const sizeBytes = Math.max(0, toFiniteNumber(t.size ?? t.total_size, 0));
    const trackerDomain = extractTrackerDomain(t.tracker);
    const category = toNonEmptyString(t.category, '未分类');
    const progress = Math.min(
      100,
      Math.max(0, Math.round(toFiniteNumber(t.progress, 0) * 1000) / 10),
    );
    const numComplete = toFiniteNumber(t.num_complete, -1);
    const numIncomplete = toFiniteNumber(t.num_incomplete, -1);
    const numSeeds = toFiniteNumber(t.num_seeds, -1);
    const torrentDlSpeed = toFiniteNumber(t.dlspeed, 0);

    const isSeeding = SEEDING_STATES.has(state);
    const isError = ERROR_STATES.has(state);
    const isStalledDl = state === 'stalledDL';
    const isDownloading = DOWNLOADING_STATES.has(state);
    const isPaused = PAUSED_STATES.has(state);

    if (isError) {
      counts.error += 1;
    } else if (isStalledDl) {
      counts.stalled += 1;
    } else if (isSeeding) {
      counts.seeding += 1;
    } else if (isDownloading) {
      counts.downloading += 1;
      if (numSeeds === 0 && torrentDlSpeed === 0) {
        counts.stalled += 1;
      }
    } else if (isPaused) {
      counts.paused += 1;
    } else {
      counts.other += 1;
    }

    const trackerStat = trackerMap.get(trackerDomain) ?? {
      name: trackerDomain,
      seedingCount: 0,
      totalCount: 0,
      totalSizeBytes: 0,
    };
    trackerStat.totalCount += 1;
    if (isSeeding) {
      trackerStat.seedingCount += 1;
    }
    trackerStat.totalSizeBytes += sizeBytes;
    trackerMap.set(trackerDomain, trackerStat);

    const categoryStat = categoryMap.get(category) ?? {
      name: category,
      seedingCount: 0,
      totalCount: 0,
      totalSizeBytes: 0,
    };
    categoryStat.totalCount += 1;
    if (isSeeding) {
      categoryStat.seedingCount += 1;
    }
    categoryStat.totalSizeBytes += sizeBytes;
    categoryMap.set(category, categoryStat);

    let problemReason: string | null = null;
    if (state === 'missingFiles') {
      problemReason = '文件缺失';
    } else if (state === 'error') {
      problemReason = '种子出错';
    } else if (isStalledDl) {
      problemReason = '下载卡住（无可用连接）';
    } else if (isSeeding && numComplete === 0 && numIncomplete === 0) {
      problemReason = '做种无连接（做种/下载节点均为 0）';
    }

    if (problemReason) {
      allProblems.push({
        hash,
        name,
        state,
        reason: problemReason,
        sizeBytes,
        trackerDomain,
        category,
        progress,
      });
    }
  }

  const sortStats = (list: QbitGroupStat[]) =>
    list
      .filter((item) => item.totalCount > 0)
      .sort((a, b) => b.seedingCount - a.seedingCount || b.totalSizeBytes - a.totalSizeBytes);

  return {
    version: params.version,
    transfer: {
      upSpeed,
      dlSpeed,
      alltimeUploadBytes,
      alltimeDownloadBytes,
      globalRatio,
      totalsApproximate,
    },
    counts,
    byTracker: sortStats([...trackerMap.values()]),
    byCategory: sortStats([...categoryMap.values()]),
    problemTorrents: allProblems.slice(0, MAX_PROBLEM_TORRENTS),
    problemTorrentsTotal: allProblems.length,
  };
}

/**
 * 生成 qBittorrent 占位模拟数据（全部采用 example.com / demo 占位）。
 */
export function createMockQbitSummary(): QbitSummaryData {
  const gib = 1024 * 1024 * 1024;
  const tib = 1024 * gib;
  return {
    version: 'v5.0.2 (mock)',
    transfer: {
      upSpeed: 18.4 * 1024 * 1024,
      dlSpeed: 4.2 * 1024 * 1024,
      alltimeUploadBytes: 24.6 * tib,
      alltimeDownloadBytes: 6.15 * tib,
      globalRatio: 4.0,
      totalsApproximate: false,
    },
    counts: {
      seeding: 42,
      downloading: 2,
      paused: 3,
      error: 1,
      stalled: 1,
      other: 0,
      total: 49,
    },
    byTracker: [
      {
        name: 'pt-alpha.example.com',
        seedingCount: 24,
        totalCount: 26,
        totalSizeBytes: 1420 * gib,
      },
      {
        name: 'pt-beta.example.com',
        seedingCount: 18,
        totalCount: 23,
        totalSizeBytes: 980 * gib,
      },
    ],
    byCategory: [
      { name: 'movies', seedingCount: 22, totalCount: 25, totalSizeBytes: 1300 * gib },
      { name: 'tv', seedingCount: 20, totalCount: 24, totalSizeBytes: 1100 * gib },
    ],
    problemTorrents: [
      {
        hash: 'demo-hash-1',
        name: 'Demo.Movie.2025.2160p.WEB-DL',
        state: 'stalledDL',
        reason: '下载卡住（无可用连接）',
        sizeBytes: 18.5 * gib,
        trackerDomain: 'pt-alpha.example.com',
        category: 'movies',
        progress: 64.2,
      },
      {
        hash: 'demo-hash-2',
        name: 'Demo.Series.S01.1080p',
        state: 'missingFiles',
        reason: '文件缺失',
        sizeBytes: 32.0 * gib,
        trackerDomain: 'pt-beta.example.com',
        category: 'tv',
        progress: 100,
      },
    ],
    problemTorrentsTotal: 2,
  };
}

export interface CreateQbittorrentServiceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  logger?: SafeLogger;
}

export interface QbittorrentService {
  getSummary: (options?: { refresh?: boolean }) => Promise<QbitSummaryResponse>;
  testConnection: (override?: QbittorrentTestOverride) => Promise<IntegrationTestResponse>;
  invalidateCache: () => void;
}

interface CacheEntry {
  expiresAtMs: number;
  response: QbitSummaryResponse;
}

/**
 * 创建 qBittorrent 只读摘要采集服务（带缓存、并发复用与失败冷却）。
 */
export function createQbittorrentService(
  integrationsStore: IntegrationsStore,
  options?: CreateQbittorrentServiceOptions,
): QbittorrentService {
  const client = createQbitClient(options?.fetchFn ?? fetch);
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;

  let cachedEntry: CacheEntry | null = null;
  let inFlightPromise: Promise<QbitSummaryResponse> | null = null;

  async function collectOnce(): Promise<QbitSummaryResponse> {
    const resolved = integrationsStore.resolveQbittorrentConfig();
    if (resolved.mock) {
      return {
        configured: true,
        mock: true,
        online: true,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        data: createMockQbitSummary(),
      };
    }

    if (!resolved.configured || !resolved.url || !resolved.username || !resolved.password) {
      return {
        configured: false,
        mock: false,
        online: false,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        errorCode: 'UNCONFIGURED',
        error: '尚未配置 qBittorrent 连接参数，请前往设置页完成配置',
      };
    }

    const cfg: QbitClientConfig = {
      url: resolved.url,
      username: resolved.username,
      password: resolved.password,
      timeoutMs: resolved.timeoutMs,
    };

    try {
      const [version, transferInfo, maindata, torrents, categories] = await Promise.all([
        client.getVersion(cfg),
        client.getTransferInfo(cfg),
        client.getMaindata(cfg),
        client.getTorrentsInfo(cfg),
        client.getCategories(cfg),
      ]);

      const finishedAt = getNow();
      const data = buildQbitSummaryData({
        version,
        transferInfo,
        maindata,
        torrents,
        categories,
      });

      const success: QbitSummaryResponse = {
        configured: true,
        mock: false,
        online: true,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        data,
      };

      const cacheTtlMs = resolved.cacheSeconds * 1000;
      if (cacheTtlMs > 0) {
        cachedEntry = { expiresAtMs: finishedAt + cacheTtlMs, response: success };
      } else {
        cachedEntry = null;
      }
      return success;
    } catch (error) {
      const finishedAt = getNow();
      const qbitErr =
        error instanceof QbitClientError
          ? error
          : new QbitClientError('CONNECTION_FAILED', '获取 qBittorrent 数据失败');
      const failure: QbitSummaryResponse = {
        configured: true,
        mock: false,
        online: false,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        errorCode: qbitErr.code,
        error: qbitErr.message,
      };
      cachedEntry = { expiresAtMs: finishedAt + FAILURE_CACHE_MS, response: failure };
      logger?.warn(`qBittorrent 状态采集失败（${qbitErr.code}）：${qbitErr.message}`);
      return failure;
    }
  }

  return {
    async getSummary(reqOptions?: { refresh?: boolean }): Promise<QbitSummaryResponse> {
      const resolved = integrationsStore.resolveQbittorrentConfig();
      if (resolved.mock) {
        return collectOnce();
      }
      if (!resolved.configured) {
        cachedEntry = null;
        return collectOnce();
      }

      const refresh = Boolean(reqOptions?.refresh);
      const nowMs = getNow();
      if (!refresh && cachedEntry && nowMs < cachedEntry.expiresAtMs) {
        return {
          ...cachedEntry.response,
          cached: true,
        };
      }

      if (inFlightPromise) {
        return inFlightPromise;
      }

      inFlightPromise = collectOnce().finally(() => {
        inFlightPromise = null;
      });
      return inFlightPromise;
    },

    async testConnection(override?: QbittorrentTestOverride): Promise<IntegrationTestResponse> {
      const startedAt = getNow();
      if (
        typeof override?.url === 'string' &&
        override.url.trim() &&
        !isValidHttpUrl(override.url.trim())
      ) {
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: '服务地址必须是有效的 http:// 或 https:// 地址',
        };
      }

      const resolved = integrationsStore.resolveQbittorrentConfig(override);
      if (!resolved.url || !resolved.username || !resolved.password) {
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: '请填写完整的 qBittorrent 地址、用户名与密码',
        };
      }

      // 测试连接使用独立的临时客户端，避免污染生产会话缓存
      const tempClient = createQbitClient(options?.fetchFn ?? fetch);
      try {
        const version = await tempClient.getVersion({
          url: resolved.url,
          username: resolved.username,
          password: resolved.password,
          timeoutMs: resolved.timeoutMs,
        });
        return {
          ok: true,
          durationMs: Math.max(0, getNow() - startedAt),
          detail: `连接成功（版本：${version}）`,
        };
      } catch (error) {
        const message =
          error instanceof QbitClientError ? error.message : 'qBittorrent 连接测试失败';
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: message,
        };
      }
    },

    invalidateCache(): void {
      cachedEntry = null;
      client.clearSessions();
    },
  };
}
