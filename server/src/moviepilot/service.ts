import type { SafeLogger } from '../config/index.js';
import type {
  IntegrationsStore,
  IntegrationTestResponse,
  MoviepilotTestOverride,
} from '../integrations/index.js';
import {
  createMoviepilotClient,
  MoviepilotClientError,
  type MoviepilotClientConfig,
} from './client.js';
import type {
  MoviepilotActiveDownloadItem,
  MoviepilotDownloadItem,
  MoviepilotDownloaderStats,
  MoviepilotSiteStatus,
  MoviepilotSubscribeItem,
  MoviepilotSummaryData,
  MoviepilotSummaryResponse,
  MoviepilotTransferItem,
  MoviepilotTransferQueueItem,
  MoviepilotTransferQueueSummary,
} from './types.js';

const FAILURE_CACHE_MS = 10_000;
const DEFAULT_MOVIEPILOT_ACTIVE_LIMIT = 10;
const MAX_MOVIEPILOT_ACTIVE_LIMIT = 100;
const MAX_QUEUE_SAMPLE_FILES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value) && Array.isArray(value.data)) {
    return value.data.filter(isRecord);
  }
  return [];
}

function toStr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function toNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return fallback;
}

function isValidHttpUrl(val: string): boolean {
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeDomain(raw: unknown): string {
  const str = toStr(raw).toLowerCase();
  if (!str) return '';
  if (str.includes('://')) {
    try {
      return new URL(str).hostname.toLowerCase();
    } catch {
      return str;
    }
  }
  return str.split('/')[0]?.split(':')[0] ?? str;
}

function clampMoviepilotActiveLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_MOVIEPILOT_ACTIVE_LIMIT;
  }
  const intVal = Math.floor(limit);
  return Math.min(MAX_MOVIEPILOT_ACTIVE_LIMIT, Math.max(1, intVal));
}

function formatBytesSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '0 B/s';
  }
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];
  let value = bytesPerSec;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatSpeedTextFromUnknown(raw: unknown): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? formatBytesSpeed(Math.max(0, parsed)) : '';
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return formatBytesSpeed(Math.max(0, raw));
  }
  return '';
}

function normalizeSeasonLabel(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return `S${String(Math.floor(raw)).padStart(2, '0')}`;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^\d+$/.test(trimmed)) {
      return `S${trimmed.padStart(2, '0')}`;
    }
    return trimmed;
  }
  return '';
}

export function extractSafeBasename(rawName: unknown, rawPath: unknown): string {
  const candidate = toStr(rawName) || toStr(rawPath);
  if (!candidate) return '';
  const withoutTrailing = candidate.replace(/[\\/]+$/, '');
  if (!withoutTrailing) return '';
  const segments = withoutTrailing.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/**
 * 解析并规范化 MoviePilot v3 汇总数据（显式剥离站点 cookie/ua/apikey/token/url 等敏感字段）。
 */
export function buildMoviepilotSummaryData(raw: {
  subscribes: unknown;
  transfers: unknown;
  downloads: unknown;
  transferQueue?: unknown;
  transferQueueUnavailableReason?: string;
  sites: unknown;
  siteStatistics: unknown;
  downloader2: unknown;
  activeLimit?: number;
}): MoviepilotSummaryData {
  const activeLimit = clampMoviepilotActiveLimit(raw.activeLimit);
  const subscribes: MoviepilotSubscribeItem[] = asArray(raw.subscribes).map((item, idx) => ({
    id: typeof item.id === 'number' || typeof item.id === 'string' ? item.id : `sub-${idx + 1}`,
    name: toStr(item.name ?? item.title, '未命名订阅'),
    year: toStr(item.year),
    type: toStr(item.type),
    season: toNum(item.season),
    state: toStr(item.state, 'unknown'),
    totalEpisode: toNum(item.total_episode),
    lackEpisode: toNum(item.lack_episode),
    lastUpdate: toStr(item.last_update),
  }));

  let transferRawList: Record<string, unknown>[] = [];
  let transferTotal = 0;
  if (Array.isArray(raw.transfers)) {
    transferRawList = raw.transfers.filter(isRecord);
    transferTotal = transferRawList.length;
  } else if (isRecord(raw.transfers)) {
    const dataNode = isRecord(raw.transfers.data) ? raw.transfers.data : raw.transfers;
    if (Array.isArray(dataNode.list)) {
      transferRawList = dataNode.list.filter(isRecord);
    }
    transferTotal = toNum(dataNode.total) ?? transferRawList.length;
  }

  const transfers: MoviepilotTransferItem[] = transferRawList.map((item) => ({
    title: toStr(item.title, '未知条目'),
    year: toStr(item.year),
    type: toStr(item.type),
    seasons: toStr(item.seasons),
    episodes: toStr(item.episodes),
    status: toBool(item.status, false),
    errmsg: toStr(item.errmsg),
    date: toStr(item.date),
    category: toStr(item.category),
  }));

  const rawDownloads = asArray(raw.downloads);
  const downloads: MoviepilotDownloadItem[] = rawDownloads.map((item) => {
    const rawProgress = toNum(item.progress) ?? 0;
    const progress =
      rawProgress > 1
        ? Math.min(100, Math.max(0, Math.round(rawProgress * 10) / 10))
        : Math.min(100, Math.max(0, Math.round(rawProgress * 1000) / 10));
    return {
      title: toStr(item.title ?? item.name, '未知下载任务'),
      name: toStr(item.name ?? item.title, '未知下载任务'),
      siteName: toStr(item.site_name),
      size: Math.max(0, toNum(item.size) ?? 0),
      progress,
      state: toStr(item.state, 'unknown'),
      dlSpeed: Math.max(0, toNum(item.dlspeed) ?? 0),
      upSpeed: Math.max(0, toNum(item.upspeed) ?? 0),
      leftTime: toStr(item.left_time),
      downloader: toStr(item.downloader),
    };
  });

  const activeDownloadsTotal = rawDownloads.length;
  const activeDownloads: MoviepilotActiveDownloadItem[] = rawDownloads
    .slice(0, activeLimit)
    .map((item) => {
      const rawProgress = toNum(item.progress) ?? 0;
      const progress = Math.min(100, Math.max(0, Math.round(rawProgress * 10) / 10));
      return {
        hash: toStr(item.hash),
        title: toStr(item.title ?? item.name, '未知下载任务'),
        name: toStr(item.name ?? item.title, '未知下载任务'),
        year: toStr(item.year),
        seasonEpisode: toStr(item.season_episode),
        downloader: toStr(item.downloader),
        size: Math.max(0, toNum(item.size) ?? 0),
        progress,
        state: toStr(item.state, 'unknown'),
        dlSpeedText: formatSpeedTextFromUnknown(item.dlspeed),
        upSpeedText: formatSpeedTextFromUnknown(item.upspeed),
        category: toStr(item.category),
        siteName: toStr(item.site_name),
        leftTime: toStr(item.left_time),
      };
    });

  let transferQueue: MoviepilotTransferQueueSummary;
  if (raw.transferQueueUnavailableReason) {
    transferQueue = {
      available: false,
      reason: raw.transferQueueUnavailableReason,
      items: [],
      total: 0,
    };
  } else {
    let queueRawList: Record<string, unknown>[] = [];
    let queueTotal = 0;

    if (Array.isArray(raw.transferQueue)) {
      queueRawList = raw.transferQueue.filter(isRecord);
      queueTotal = queueRawList.length;
    } else if (isRecord(raw.transferQueue)) {
      const node = isRecord(raw.transferQueue.data) ? raw.transferQueue.data : raw.transferQueue;
      if (Array.isArray(node.items)) {
        queueRawList = node.items.filter(isRecord);
      } else if (Array.isArray(node.list)) {
        queueRawList = node.list.filter(isRecord);
      }
      queueTotal = Math.max(0, toNum(node.total) ?? queueRawList.length);
    }

    const parsedQueueItems: MoviepilotTransferQueueItem[] = queueRawList.map((entry) => {
      const media = isRecord(entry.media) ? entry.media : null;
      const title =
        toStr(media?.title) || toStr(media?.title_year) || toStr(entry.title) || '未知媒体';
      const year = toStr(media?.year) || toStr(entry.year);
      const season = normalizeSeasonLabel(entry.season);
      const tasks = Array.isArray(entry.tasks) ? entry.tasks.filter(isRecord) : [];

      const stateCounts: Record<string, number> = {};
      const sampleFiles: string[] = [];

      for (const task of tasks) {
        const taskState = toStr(task.state, 'unknown');
        stateCounts[taskState] = (stateCounts[taskState] ?? 0) + 1;

        if (sampleFiles.length < MAX_QUEUE_SAMPLE_FILES) {
          const fileItem = isRecord(task.fileitem) ? task.fileitem : null;
          const basename = extractSafeBasename(fileItem?.name, fileItem?.path);
          if (basename) {
            sampleFiles.push(basename);
          }
        }
      }

      return {
        title,
        year,
        season,
        taskCount: tasks.length,
        stateCounts,
        sampleFiles,
      };
    });

    transferQueue = {
      available: true,
      items: parsedQueueItems.slice(0, activeLimit),
      total: queueTotal,
    };
  }
  const transferQueueTotal = transferQueue.total;

  const statByDomain = new Map<string, Record<string, unknown>>();
  for (const stat of asArray(raw.siteStatistics)) {
    const domain = normalizeDomain(stat.domain);
    if (domain) {
      statByDomain.set(domain, stat);
    }
  }

  // 严格白名单提取站点安全字段（仅 id, name, domain, is_active, pri），绝不转发 cookie/ua/apikey/token/url
  const sites: MoviepilotSiteStatus[] = asArray(raw.sites).map((site, idx) => {
    const safeId =
      typeof site.id === 'number' || typeof site.id === 'string' ? site.id : `site-${idx + 1}`;
    const safeName = toStr(site.name, '未命名站点');
    const safeDomain = normalizeDomain(site.domain ?? site.url);
    const safeActive = toBool(site.is_active, true);
    const safePriority = toNum(site.pri);

    const stat = safeDomain ? statByDomain.get(safeDomain) : undefined;
    const successCount = Math.max(0, toNum(stat?.success) ?? 0);
    const failCount = Math.max(0, toNum(stat?.fail) ?? 0);
    const rawSeconds = toNum(stat?.seconds);
    const avgSeconds = rawSeconds !== null ? Math.round(rawSeconds * 100) / 100 : null;
    const rawLastState = toNum(stat?.lst_state);
    const lastState: MoviepilotSiteStatus['lastState'] =
      rawLastState === 0 ? 'success' : rawLastState === 1 ? 'fail' : 'unknown';
    const lastModDate = toStr(stat?.lst_mod_date);

    return {
      id: safeId,
      name: safeName,
      domain: safeDomain,
      isActive: safeActive,
      priority: safePriority,
      successCount,
      failCount,
      avgSeconds,
      lastState,
      lastModDate,
    };
  });

  let downloader: MoviepilotDownloaderStats | null = null;
  if (isRecord(raw.downloader2)) {
    const d = isRecord(raw.downloader2.data) ? raw.downloader2.data : raw.downloader2;
    const hasKnownField =
      d.download_speed !== undefined ||
      d.upload_speed !== undefined ||
      d.download_size !== undefined ||
      d.upload_size !== undefined ||
      d.free_space !== undefined;
    if (hasKnownField) {
      downloader = {
        downloadSpeed: Math.max(0, toNum(d.download_speed) ?? 0),
        uploadSpeed: Math.max(0, toNum(d.upload_speed) ?? 0),
        downloadSize: Math.max(0, toNum(d.download_size) ?? 0),
        uploadSize: Math.max(0, toNum(d.upload_size) ?? 0),
        freeSpace: Math.max(0, toNum(d.free_space) ?? 0),
      };
    }
  }

  return {
    subscribes,
    transfers,
    transferTotal,
    downloads,
    activeDownloads,
    activeDownloadsTotal,
    transferQueue,
    transferQueueTotal,
    sites,
    downloader,
  };
}

/**
 * 生成 MoviePilot v3 占位模拟数据（全部采用 example.com / demo 占位）。
 */
export function createMockMoviepilotSummary(activeLimit?: number): MoviepilotSummaryData {
  const gib = 1024 * 1024 * 1024;
  const limit = clampMoviepilotActiveLimit(activeLimit);

  const mockActiveDownloads: MoviepilotActiveDownloadItem[] = [
    {
      hash: 'demo-mp-dl-1',
      title: '示例剧集 Alpha',
      name: 'Demo.Series.Alpha.S02E11.2160p.WEB-DL',
      year: '2025',
      seasonEpisode: 'S02E11',
      downloader: 'qB 下载',
      size: 6.4 * gib,
      progress: 72.5,
      state: 'downloading',
      dlSpeedText: '12.5 MiB/s',
      upSpeedText: '1.8 MiB/s',
      category: '欧美剧',
      siteName: '示例站点 A',
      leftTime: '6 分钟',
    },
    {
      hash: 'demo-mp-dl-2',
      title: '示例电影 Epsilon',
      name: 'Demo.Movie.Epsilon.2025.1080p.BluRay',
      year: '2025',
      seasonEpisode: '',
      downloader: 'qB 刷流',
      size: 14.2 * gib,
      progress: 38.0,
      state: 'downloading',
      dlSpeedText: '8.4 MiB/s',
      upSpeedText: '2.1 MiB/s',
      category: '电影',
      siteName: '示例站点 B',
      leftTime: '18 分钟',
    },
  ];

  const mockQueueItems: MoviepilotTransferQueueItem[] = [
    {
      title: '示例剧集 Alpha',
      year: '2025',
      season: 'S02',
      taskCount: 3,
      stateCounts: { running: 1, waiting: 2 },
      sampleFiles: [
        'Demo.Series.Alpha.S02E09.2160p.mkv',
        'Demo.Series.Alpha.S02E10.2160p.mkv',
        'Demo.Series.Alpha.S02E11.2160p.mkv',
      ],
    },
    {
      title: '示例电影 Gamma',
      year: '2025',
      season: '',
      taskCount: 1,
      stateCounts: { waiting: 1 },
      sampleFiles: ['Demo.Movie.Gamma.2025.2160p.WEB-DL.mkv'],
    },
  ];

  return {
    subscribes: [
      {
        id: 1,
        name: '示例剧集 Alpha',
        year: '2025',
        type: '电视剧',
        season: 2,
        state: 'R',
        totalEpisode: 12,
        lackEpisode: 2,
        lastUpdate: '2026-11-27 10:15:00',
      },
      {
        id: 2,
        name: '示例纪录片 Beta',
        year: '2026',
        type: '电视剧',
        season: 1,
        state: 'N',
        totalEpisode: 8,
        lackEpisode: 0,
        lastUpdate: '2026-11-26 21:40:00',
      },
      {
        id: 3,
        name: '示例电影 Gamma',
        year: '2025',
        type: '电影',
        season: null,
        state: 'R',
        totalEpisode: 1,
        lackEpisode: 1,
        lastUpdate: '2026-11-26 18:05:00',
      },
    ],
    transfers: [
      {
        title: '示例剧集 Alpha',
        year: '2025',
        type: '电视剧',
        seasons: 'S02',
        episodes: 'E10',
        status: true,
        errmsg: '',
        date: '2026-11-27 11:20:00',
        category: '欧美剧',
      },
      {
        title: '示例电影 Delta',
        year: '2024',
        type: '电影',
        seasons: '',
        episodes: '',
        status: true,
        errmsg: '',
        date: '2026-11-27 09:05:00',
        category: '华语电影',
      },
      {
        title: '示例动画 Epsilon',
        year: '2026',
        type: '电视剧',
        seasons: 'S01',
        episodes: 'E04',
        status: false,
        errmsg: '目标目录已存在同名文件',
        date: '2026-11-26 23:12:00',
        category: '动漫',
      },
    ],
    transferTotal: 3,
    downloads: [
      {
        title: '示例剧集 Alpha S02E11',
        name: 'Demo.Series.Alpha.S02E11.2160p.WEB-DL',
        siteName: '示例站点 A',
        size: 6.4 * gib,
        progress: 72.5,
        state: 'downloading',
        dlSpeed: 12.5 * 1024 * 1024,
        upSpeed: 1.8 * 1024 * 1024,
        leftTime: '6 分钟',
        downloader: 'qBittorrent',
      },
    ],
    activeDownloads: mockActiveDownloads.slice(0, limit),
    activeDownloadsTotal: mockActiveDownloads.length,
    transferQueue: {
      available: true,
      items: mockQueueItems.slice(0, limit),
      total: mockQueueItems.length,
    },
    transferQueueTotal: mockQueueItems.length,
    sites: [
      {
        id: 1,
        name: '示例站点 A',
        domain: 'pt-alpha.example.com',
        isActive: true,
        priority: 1,
        successCount: 128,
        failCount: 2,
        avgSeconds: 0.42,
        lastState: 'success',
        lastModDate: '2026-11-27 11:30:00',
      },
      {
        id: 2,
        name: '示例站点 B',
        domain: 'pt-beta.example.com',
        isActive: true,
        priority: 2,
        successCount: 45,
        failCount: 3,
        avgSeconds: 1.85,
        lastState: 'fail',
        lastModDate: '2026-11-27 10:50:00',
      },
    ],
    downloader: {
      downloadSpeed: 12.5 * 1024 * 1024,
      uploadSpeed: 18.4 * 1024 * 1024,
      downloadSize: 6.15 * 1024 * gib,
      uploadSize: 24.6 * 1024 * gib,
      freeSpace: 1800 * gib,
    },
  };
}

export interface CreateMoviepilotServiceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  logger?: SafeLogger;
}

export interface MoviepilotService {
  getSummary: (options?: { refresh?: boolean }) => Promise<MoviepilotSummaryResponse>;
  testConnection: (override?: MoviepilotTestOverride) => Promise<IntegrationTestResponse>;
  invalidateCache: () => void;
}

interface CacheEntry {
  expiresAtMs: number;
  response: MoviepilotSummaryResponse;
}

/**
 * 创建 MoviePilot v3 只读汇总服务（带缓存、并发复用与失败冷却）。
 */
export function createMoviepilotService(
  integrationsStore: IntegrationsStore,
  options?: CreateMoviepilotServiceOptions,
): MoviepilotService {
  const client = createMoviepilotClient(options?.fetchFn ?? fetch);
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;

  let cachedEntry: CacheEntry | null = null;
  let inFlightPromise: Promise<MoviepilotSummaryResponse> | null = null;

  async function collectOnce(): Promise<MoviepilotSummaryResponse> {
    const resolved = integrationsStore.resolveMoviepilotConfig();
    if (resolved.mock) {
      return {
        configured: true,
        mock: true,
        online: true,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        data: createMockMoviepilotSummary(resolved.activeLimit),
      };
    }

    if (!resolved.configured || !resolved.url || !resolved.apiToken) {
      return {
        configured: false,
        mock: false,
        online: false,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        errorCode: 'UNCONFIGURED',
        error: '尚未配置 MoviePilot 连接参数，请前往设置页完成配置',
      };
    }

    const cfg: MoviepilotClientConfig = {
      url: resolved.url,
      apiToken: resolved.apiToken,
      timeoutMs: resolved.timeoutMs,
    };

    try {
      const [
        subscribes,
        transfers,
        downloads,
        transferQueueResult,
        sites,
        siteStatistics,
        downloader2,
      ] = await Promise.all([
        client.getSubscribes(cfg),
        client.getTransferHistory(cfg, 1, 20),
        client.getDownloads(cfg),
        client
          .getTransferQueue(cfg, 1, 20)
          .then((value) => ({ ok: true as const, value }))
          .catch((err: unknown) => {
            if (err instanceof MoviepilotClientError && err.code === 'AUTH_FAILED') {
              throw err;
            }
            return { ok: false as const, reason: '当前 MoviePilot 版本不支持整理队列' };
          }),
        client.getSites(cfg),
        client.getSiteStatistics(cfg),
        client.getDownloader2(cfg),
      ]);

      const finishedAt = getNow();
      const data = buildMoviepilotSummaryData({
        subscribes,
        transfers,
        downloads,
        ...(transferQueueResult.ok
          ? { transferQueue: transferQueueResult.value }
          : { transferQueueUnavailableReason: transferQueueResult.reason }),
        sites,
        siteStatistics,
        downloader2,
        activeLimit: resolved.activeLimit,
      });

      const success: MoviepilotSummaryResponse = {
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
      const mpErr =
        error instanceof MoviepilotClientError
          ? error
          : new MoviepilotClientError('CONNECTION_FAILED', '获取 MoviePilot 数据失败');
      const failure: MoviepilotSummaryResponse = {
        configured: true,
        mock: false,
        online: false,
        checkedAt: new Date(finishedAt).toISOString(),
        cached: false,
        errorCode: mpErr.code,
        error: mpErr.message,
      };
      cachedEntry = { expiresAtMs: finishedAt + FAILURE_CACHE_MS, response: failure };
      logger?.warn(`MoviePilot 状态采集失败（${mpErr.code}）：${mpErr.message}`);
      return failure;
    }
  }

  return {
    async getSummary(reqOptions?: { refresh?: boolean }): Promise<MoviepilotSummaryResponse> {
      const resolved = integrationsStore.resolveMoviepilotConfig();
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

    async testConnection(override?: MoviepilotTestOverride): Promise<IntegrationTestResponse> {
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

      const resolved = integrationsStore.resolveMoviepilotConfig(override);
      if (!resolved.url || !resolved.apiToken) {
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: '请填写完整的 MoviePilot 地址与 API 令牌',
        };
      }

      try {
        await client.getDownloader2({
          url: resolved.url,
          apiToken: resolved.apiToken,
          timeoutMs: resolved.timeoutMs,
        });
        return {
          ok: true,
          durationMs: Math.max(0, getNow() - startedAt),
          detail: 'MoviePilot API 连接成功',
        };
      } catch (error) {
        const message =
          error instanceof MoviepilotClientError ? error.message : 'MoviePilot 连接测试失败';
        return {
          ok: false,
          durationMs: Math.max(0, getNow() - startedAt),
          error: message,
        };
      }
    },

    invalidateCache(): void {
      cachedEntry = null;
    },
  };
}
