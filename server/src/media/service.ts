import type { AppConfig, SafeLogger } from '../config/index.js';
import type { DownloadersService } from '../downloaders/index.js';
import type { IntegrationsStore } from '../integrations/index.js';
import {
  createMoviepilotClient,
  MoviepilotClientError,
  type MoviepilotClientConfig,
} from '../moviepilot/client.js';
import type { MediaImageProxy } from './image-proxy.js';
import type {
  MediaDownloadsResponse,
  MediaOverviewLibraryStats,
  MediaOverviewResponse,
  MediaSubscriptionsResponse,
} from './types.js';
import {
  addDaysToDateKey,
  asRecordArray,
  buildMediaSubscriptions,
  buildPosterFallbackIndexes,
  extractCalendarItems,
  extractTransferHistoryList,
  getDateKeyInTimeZone,
  groupRecentTransfers,
  isBrushInstance,
  isRecord,
  mergeMediaDownloads,
  parseMpDateKey,
  QBIT_DOWNLOADING_CLASS_STATES,
  selectMediaDownloadInstances,
  selectMediaSeedInstances,
  toBool,
  toNum,
  toStr,
  type QbitTorrentWithInstance,
} from './utils.js';

const DEFAULT_MEDIA_CACHE_SECONDS = 30;
const CALENDAR_PAST_DAYS = 14;
const CALENDAR_FUTURE_DAYS = 60;

export interface CreateMediaServiceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  logger?: SafeLogger;
}

export interface MediaService {
  getOverview: (options?: { refresh?: boolean }) => Promise<MediaOverviewResponse>;
  getDownloads: (options?: { refresh?: boolean }) => Promise<MediaDownloadsResponse>;
  getSubscriptions: (options?: { refresh?: boolean }) => Promise<MediaSubscriptionsResponse>;
  invalidateCache: () => void;
}

interface EndpointCache<T> {
  expiresAtMs: number;
  response: T;
}

function createMockMediaOverview(
  nowMs: number,
  imageProxy: MediaImageProxy,
): MediaOverviewResponse {
  const checkedAt = new Date(nowMs).toISOString();
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;
  const tib = 1024 * gib;

  return {
    configured: true,
    mock: true,
    checkedAt,
    cached: false,
    warnings: [],
    stats: {
      downloading: 2,
      pendingTransfer: 2,
      todayImported: 2,
      todayImportedApproximate: false,
      seeding: 128,
      seedUploadSpeed: 9.8 * mib,
      seedTotalUploaded: 18.2 * tib,
      library: {
        movieCount: 342,
        tvCount: 68,
        episodeCount: 1840,
      },
    },
    recent: [
      {
        title: '示例剧集 Alpha',
        year: '2025',
        type: '电视剧',
        season: 'S02',
        episodes: 'E09-E10',
        episodeCount: 2,
        date: '2026-11-27 11:20:00',
        importedAt: new Date(nowMs - 2 * 3600_000).toISOString(),
        posterUrl: imageProxy.toProxyUrl('https://image.tmdb.org/t/p/original/demo-alpha.jpg'),
      },
      {
        title: '示例电影 Delta',
        year: '2024',
        type: '电影',
        season: '',
        episodes: '',
        episodeCount: null,
        date: '2026-11-27 09:05:00',
        importedAt: new Date(nowMs - 4 * 3600_000).toISOString(),
        posterUrl: null,
      },
    ],
  };
}

function createMockMediaDownloads(
  nowMs: number,
  imageProxy: MediaImageProxy,
): MediaDownloadsResponse {
  const checkedAt = new Date(nowMs).toISOString();
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;
  return {
    configured: true,
    mock: true,
    checkedAt,
    cached: false,
    warnings: [],
    items: [
      {
        hash: 'demo-mp-dl-1',
        displayName: '示例剧集 Alpha',
        torrentName: 'Demo.Series.Alpha.S02E11.2160p.WEB-DL',
        year: '2025',
        seasonEpisode: 'S02E11',
        posterUrl: imageProxy.toProxyUrl('https://image.tmdb.org/t/p/w500/demo-alpha.jpg'),
        progress: 0.725,
        dlSpeed: 12.5 * mib,
        upSpeed: 1.8 * mib,
        dlSpeedText: null,
        upSpeedText: null,
        eta: 360,
        leftTime: null,
        size: 6.4 * gib,
        state: '下载中',
        instanceName: 'qB 下载',
        site: '示例站点 A',
        matched: true,
      },
      {
        hash: 'demo-qb-unmatched-1',
        displayName: 'Demo Movie 2025 2160p UHD BluRay x265',
        torrentName: '[ExamplePT].Demo.Movie.2025.2160p.UHD.BluRay.x265',
        year: '',
        seasonEpisode: '',
        posterUrl: null,
        progress: 0.41,
        dlSpeed: 4.2 * mib,
        upSpeed: 0.6 * mib,
        dlSpeedText: null,
        upSpeedText: null,
        eta: 1500,
        leftTime: null,
        size: 42.5 * gib,
        state: '下载中',
        instanceName: 'qB 下载',
        site: '',
        matched: false,
      },
    ],
  };
}

function createMockMediaSubscriptions(
  nowMs: number,
  timeZone: string,
  imageProxy: MediaImageProxy,
): MediaSubscriptionsResponse {
  const todayKey = getDateKeyInTimeZone(new Date(nowMs), timeZone);
  const nextSatKey = addDaysToDateKey(todayKey, 3);
  return {
    configured: true,
    mock: true,
    checkedAt: new Date(nowMs).toISOString(),
    cached: false,
    calendarAvailable: true,
    warnings: [],
    items: [
      {
        id: 1,
        name: '示例剧集 Alpha',
        year: '2025',
        type: '电视剧',
        season: 2,
        posterUrl: imageProxy.toProxyUrl('https://image.tmdb.org/t/p/original/demo-alpha.jpg'),
        state: '订阅中',
        totalEpisode: 12,
        startEpisode: 1,
        completedEpisode: 8,
        lackEpisode: 2,
        downloadedEpisodes: [1, 2, 4, 6, 7, 8, 9, 10],
        latestEpisode: 10,
        missingEpisodes: [3, 5],
        missingInferred: false,
        nextAir: {
          date: nextSatKey,
          episodeNumber: 11,
          name: '第 11 集',
        },
        hasAired: null,
        lastUpdate: '2026-11-27 10:15:00',
      },
      {
        id: 2,
        name: '示例电影 Gamma',
        year: '2025',
        type: '电影',
        season: null,
        posterUrl: null,
        state: '订阅中',
        totalEpisode: 1,
        startEpisode: 1,
        completedEpisode: 0,
        lackEpisode: 1,
        downloadedEpisodes: [],
        latestEpisode: null,
        missingEpisodes: [],
        missingInferred: false,
        nextAir: {
          date: addDaysToDateKey(todayKey, 12),
          episodeNumber: null,
          name: '示例电影 Gamma',
        },
        hasAired: false,
        lastUpdate: '2026-11-26 18:05:00',
      },
    ],
  };
}

/**
 * 创建影视模块 V1 只读聚合服务（统一缓存、独立降级告警、tag 实例归属过滤）。
 */
export function createMediaService(
  config: AppConfig,
  integrationsStore: IntegrationsStore,
  downloadersService: DownloadersService,
  imageProxy: MediaImageProxy,
  options?: CreateMediaServiceOptions,
): MediaService {
  const mpClient = createMoviepilotClient(options?.fetchFn ?? fetch);
  const getNow = options?.now ?? Date.now;
  const logger = options?.logger;
  const timeZone = config.app.TZ_DISPLAY;
  const cacheSeconds = config.media?.MEDIA_CACHE_SECONDS ?? DEFAULT_MEDIA_CACHE_SECONDS;

  let overviewCache: EndpointCache<MediaOverviewResponse> | null = null;
  let downloadsCache: EndpointCache<MediaDownloadsResponse> | null = null;
  let subscriptionsCache: EndpointCache<MediaSubscriptionsResponse> | null = null;

  let inFlightOverview: Promise<MediaOverviewResponse> | null = null;
  let inFlightDownloads: Promise<MediaDownloadsResponse> | null = null;
  let inFlightSubscriptions: Promise<MediaSubscriptionsResponse> | null = null;

  function resolveMpClientConfig(): {
    configured: boolean;
    mock: boolean;
    cfg: MoviepilotClientConfig | null;
  } {
    const mp = integrationsStore.resolveMoviepilotConfig();
    if (mp.mock) {
      return { configured: true, mock: true, cfg: null };
    }
    if (!mp.configured || !mp.url || !mp.apiToken) {
      return { configured: false, mock: false, cfg: null };
    }
    return {
      configured: true,
      mock: false,
      cfg: {
        url: mp.url,
        apiToken: mp.apiToken,
        timeoutMs: mp.timeoutMs,
      },
    };
  }

  function toPosterUrl(rawUrl: unknown, mpUrl?: string): string | null {
    return imageProxy.toProxyUrl(rawUrl, mpUrl);
  }

  function getBrushInstanceNames(): Set<string> {
    const dlConfig = integrationsStore.resolveDownloadersConfig();
    const names = new Set<string>();
    for (const inst of dlConfig.instances) {
      if (isBrushInstance(inst)) {
        names.add(inst.name.trim().toLowerCase());
      }
    }
    return names;
  }

  function formatMpWarning(sourceLabel: string, error: unknown): string {
    if (error instanceof MoviepilotClientError) {
      return `${sourceLabel}：${error.message}`;
    }
    return `${sourceLabel}暂时不可用`;
  }

  async function collectOverview(refresh: boolean): Promise<MediaOverviewResponse> {
    const mpResolved = resolveMpClientConfig();
    const dlResolved = integrationsStore.resolveDownloadersConfig();
    const nowMs = getNow();

    if (mpResolved.mock) {
      return createMockMediaOverview(nowMs, imageProxy);
    }

    const downloadInstances = selectMediaDownloadInstances(dlResolved.instances);
    const seedInstances = selectMediaSeedInstances(dlResolved.instances);
    const hasAnyConfigured =
      mpResolved.configured || downloadInstances.length > 0 || seedInstances.length > 0;

    if (!hasAnyConfigured) {
      return {
        configured: false,
        mock: false,
        checkedAt: new Date(nowMs).toISOString(),
        cached: false,
        warnings: [],
        stats: {
          downloading: 0,
          pendingTransfer: null,
          todayImported: 0,
          todayImportedApproximate: false,
          seeding: null,
          seedUploadSpeed: null,
          seedTotalUploaded: null,
          library: null,
        },
        recent: [],
      };
    }

    const warnings: string[] = [];
    const mpCfg = mpResolved.cfg;
    const brushNames = getBrushInstanceNames();

    if (!mpCfg) {
      warnings.push('尚未配置 MoviePilot，仅展示下载器统计数据');
    }

    const [
      qbitTorrentsResults,
      seedSummariesResults,
      mpDownloadsResult,
      mpTransferQueueResult,
      mpHistoryResult,
      mpStatsResult,
    ] = await Promise.all([
      Promise.all(
        downloadInstances.map((inst) =>
          downloadersService.getInstanceTorrents(inst.id, { refresh }),
        ),
      ),
      Promise.all(
        seedInstances.map((inst) => downloadersService.getInstanceSummary(inst.id, { refresh })),
      ),
      mpCfg
        ? mpClient
            .getDownloads(mpCfg)
            .then((value) => ({ ok: true as const, value }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve(null),
      mpCfg
        ? mpClient
            .getTransferQueue(mpCfg, 1, 1)
            .then((value) => ({ ok: true as const, value }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve(null),
      mpCfg
        ? mpClient
            .getTransferHistory(mpCfg, 1, 100)
            .then((value) => ({ ok: true as const, value }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve(null),
      mpCfg
        ? mpClient
            .getDashboardStatistic(mpCfg)
            .then((value) => ({ ok: true as const, value }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve(null),
    ]);

    // 1. 下载中计数（qB-download 中下载状态 + MP 下载中按 hash 去重）
    const downloadingHashes = new Set<string>();
    let qbDownloadingNoHashCount = 0;
    for (const res of qbitTorrentsResults) {
      if (!res.ok) {
        warnings.push(`下载器 ${res.instanceName}：${res.error}`);
        continue;
      }
      for (const t of res.torrents) {
        const rawState = toStr(t.state);
        if (!QBIT_DOWNLOADING_CLASS_STATES.has(rawState)) {
          continue;
        }
        const hash = toStr(t.hash).toLowerCase();
        if (hash) {
          downloadingHashes.add(hash);
        } else {
          qbDownloadingNoHashCount += 1;
        }
      }
    }

    let mpDownloadingNoHashCount = 0;
    if (mpDownloadsResult) {
      if (mpDownloadsResult.ok) {
        for (const item of asRecordArray(mpDownloadsResult.value)) {
          const downloaderName = toStr(item.downloader).toLowerCase();
          if (downloaderName && brushNames.has(downloaderName)) {
            continue;
          }
          const stateLower = toStr(item.state, 'downloading').toLowerCase();
          if (stateLower === 'paused' || stateLower === 'stopped' || stateLower === 'seeding') {
            continue;
          }
          const hash = toStr(item.hash).toLowerCase();
          if (hash) {
            downloadingHashes.add(hash);
          } else {
            mpDownloadingNoHashCount += 1;
          }
        }
      } else {
        warnings.push(formatMpWarning('MoviePilot 下载任务获取失败', mpDownloadsResult.error));
      }
    }
    const downloadingCount =
      downloadingHashes.size + qbDownloadingNoHashCount + mpDownloadingNoHashCount;

    // 2. 待整理队列 total
    let pendingTransfer: number | null = null;
    if (mpTransferQueueResult) {
      if (mpTransferQueueResult.ok) {
        const rawQ = mpTransferQueueResult.value;
        if (Array.isArray(rawQ)) {
          pendingTransfer = rawQ.length;
        } else if (isRecord(rawQ)) {
          const node = isRecord(rawQ.data) ? rawQ.data : rawQ;
          const itemsLen = Array.isArray(node.items)
            ? node.items.length
            : Array.isArray(node.list)
              ? node.list.length
              : 0;
          pendingTransfer = Math.max(0, toNum(node.total) ?? itemsLen);
        } else {
          pendingTransfer = 0;
        }
      } else {
        warnings.push(formatMpWarning('MoviePilot 整理队列获取失败', mpTransferQueueResult.error));
      }
    }

    // 3. 今日入库 & 最近入库海报墙
    let todayImported = 0;
    let todayImportedApproximate = false;
    let recent: MediaOverviewResponse['recent'] = [];
    if (mpHistoryResult) {
      if (mpHistoryResult.ok) {
        const { list } = extractTransferHistoryList(mpHistoryResult.value);
        const todayKey = getDateKeyInTimeZone(new Date(getNow()), timeZone);
        let recordsFromTodayCount = 0;

        for (const item of list) {
          const dateKey = parseMpDateKey(toStr(item.date), timeZone);
          if (dateKey === todayKey) {
            recordsFromTodayCount += 1;
            if (toBool(item.status, false)) {
              todayImported += 1;
            }
          }
        }
        if (list.length >= 100 && recordsFromTodayCount === list.length) {
          todayImportedApproximate = true;
        }

        recent = groupRecentTransfers(
          list,
          (rawImg) => toPosterUrl(rawImg, mpCfg?.url),
          timeZone,
          24,
        );
      } else {
        warnings.push(formatMpWarning('MoviePilot 入库记录获取失败', mpHistoryResult.error));
      }
    }

    // 4. 保种实例统计（seed 标签且非 brush）
    let seeding: number | null = null;
    let seedUploadSpeed: number | null = null;
    let seedTotalUploaded: number | null = null;

    if (seedInstances.length > 0) {
      let onlineSeedCount = 0;
      let seedingSum = 0;
      let upSpeedSum = 0;
      let totalUploadedSum = 0;
      let allHaveExactTotalUploaded = true;

      for (const res of seedSummariesResults) {
        if (!res.found) continue;
        const inst = res.data;
        if (!inst.online) {
          warnings.push(`保种下载器 ${inst.name}：${inst.error ?? '离线'}`);
          continue;
        }
        onlineSeedCount += 1;
        seedingSum += inst.counts.seeding;
        upSpeedSum += inst.upSpeed;

        if (
          typeof inst.totalUploaded === 'number' &&
          Number.isFinite(inst.totalUploaded) &&
          !inst.totalsApproximate
        ) {
          totalUploadedSum += inst.totalUploaded;
        } else {
          allHaveExactTotalUploaded = false;
        }
      }

      if (onlineSeedCount > 0) {
        seeding = seedingSum;
        seedUploadSpeed = upSpeedSum;
        seedTotalUploaded = allHaveExactTotalUploaded ? totalUploadedSum : null;
      }
    }

    // 5. 媒体库统计
    let library: MediaOverviewLibraryStats | null = null;
    if (mpStatsResult) {
      if (mpStatsResult.ok) {
        const rawStat = mpStatsResult.value;
        if (isRecord(rawStat)) {
          const node = isRecord(rawStat.data) ? rawStat.data : rawStat;
          const movieCount = toNum(node.movie_count);
          const tvCount = toNum(node.tv_count);
          const episodeCount = toNum(node.episode_count);
          if (movieCount !== null || tvCount !== null || episodeCount !== null) {
            library = {
              movieCount: Math.max(0, movieCount ?? 0),
              tvCount: Math.max(0, tvCount ?? 0),
              episodeCount: Math.max(0, episodeCount ?? 0),
            };
          }
        }
      } else {
        warnings.push(formatMpWarning('MoviePilot 媒体库统计获取失败', mpStatsResult.error));
      }
    }

    const finishedAt = getNow();
    const response: MediaOverviewResponse = {
      configured: true,
      mock: false,
      checkedAt: new Date(finishedAt).toISOString(),
      cached: false,
      warnings,
      stats: {
        downloading: downloadingCount,
        pendingTransfer,
        todayImported,
        todayImportedApproximate,
        seeding,
        seedUploadSpeed,
        seedTotalUploaded,
        library,
      },
      recent,
    };

    if (cacheSeconds > 0 && warnings.length === 0) {
      overviewCache = { expiresAtMs: finishedAt + cacheSeconds * 1000, response };
    } else if (cacheSeconds > 0 && warnings.length > 0) {
      // 降级响应短缓存，避免高频刷崩下游，同时允许很快恢复
      overviewCache = {
        expiresAtMs: finishedAt + Math.min(cacheSeconds, 10) * 1000,
        response,
      };
    } else {
      overviewCache = null;
    }

    return response;
  }

  async function collectDownloads(refresh: boolean): Promise<MediaDownloadsResponse> {
    const mpResolved = resolveMpClientConfig();
    const dlResolved = integrationsStore.resolveDownloadersConfig();
    const nowMs = getNow();

    if (mpResolved.mock || dlResolved.mock) {
      return createMockMediaDownloads(nowMs, imageProxy);
    }

    const downloadInstances = selectMediaDownloadInstances(dlResolved.instances);
    if (!mpResolved.configured && downloadInstances.length === 0) {
      return {
        configured: false,
        mock: false,
        checkedAt: new Date(nowMs).toISOString(),
        cached: false,
        warnings: [],
        items: [],
      };
    }

    const warnings: string[] = [];
    const mpCfg = mpResolved.cfg;
    const brushNames = getBrushInstanceNames();

    if (!mpCfg) {
      warnings.push('尚未配置 MoviePilot，无法匹配中文片名与海报');
    }

    const [qbitResults, mpDownloadsRes, mpSubscribesRes, mpHistoryRes] = await Promise.all([
      Promise.all(
        downloadInstances.map((inst) =>
          downloadersService.getInstanceTorrents(inst.id, { refresh }),
        ),
      ),
      mpCfg
        ? mpClient
            .getDownloads(mpCfg)
            .then((value) => ({ ok: true as const, value }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve(null),
      mpCfg ? mpClient.getSubscribes(mpCfg).catch(() => null) : Promise.resolve(null),
      mpCfg ? mpClient.getTransferHistory(mpCfg, 1, 100).catch(() => null) : Promise.resolve(null),
    ]);

    const qbitTorrents: QbitTorrentWithInstance[] = [];
    for (const res of qbitResults) {
      if (!res.ok) {
        warnings.push(`下载器 ${res.instanceName}：${res.error}`);
        continue;
      }
      for (const torrent of res.torrents) {
        qbitTorrents.push({ instanceName: res.instanceName, torrent });
      }
    }

    let mpDownloadsRaw: Record<string, unknown>[] = [];
    if (mpDownloadsRes) {
      if (mpDownloadsRes.ok) {
        mpDownloadsRaw = asRecordArray(mpDownloadsRes.value);
      } else {
        warnings.push(formatMpWarning('MoviePilot 下载列表获取失败', mpDownloadsRes.error));
      }
    }

    const subscribesRaw = mpSubscribesRes ? asRecordArray(mpSubscribesRes) : [];
    const transfersRaw = mpHistoryRes ? extractTransferHistoryList(mpHistoryRes).list : [];
    const posterFallbacks = buildPosterFallbackIndexes(subscribesRaw, transfersRaw, (rawImg) =>
      toPosterUrl(rawImg, mpCfg?.url),
    );

    const items = mergeMediaDownloads({
      qbitTorrents,
      mpDownloadsRaw,
      brushInstanceNames: brushNames,
      posterFallbacks,
      toPosterUrl: (rawImg) => toPosterUrl(rawImg, mpCfg?.url),
    });

    const finishedAt = getNow();
    const response: MediaDownloadsResponse = {
      configured: true,
      mock: false,
      checkedAt: new Date(finishedAt).toISOString(),
      cached: false,
      warnings,
      items,
    };

    if (cacheSeconds > 0) {
      const ttlSeconds = warnings.length > 0 ? Math.min(cacheSeconds, 10) : cacheSeconds;
      downloadsCache = { expiresAtMs: finishedAt + ttlSeconds * 1000, response };
    } else {
      downloadsCache = null;
    }

    return response;
  }

  async function collectSubscriptions(): Promise<MediaSubscriptionsResponse> {
    const mpResolved = resolveMpClientConfig();
    const nowMs = getNow();

    if (mpResolved.mock) {
      return createMockMediaSubscriptions(nowMs, timeZone, imageProxy);
    }

    if (!mpResolved.configured || !mpResolved.cfg) {
      return {
        configured: false,
        mock: false,
        checkedAt: new Date(nowMs).toISOString(),
        cached: false,
        calendarAvailable: false,
        warnings: [],
        items: [],
      };
    }

    const mpCfg = mpResolved.cfg;
    const todayKey = getDateKeyInTimeZone(new Date(nowMs), timeZone);
    const startKey = addDaysToDateKey(todayKey, -CALENDAR_PAST_DAYS);
    // end 不含，+61 天以包含今天起 60 天窗口（总跨度 75 天 <= 93 天）
    const endKey = addDaysToDateKey(todayKey, CALENDAR_FUTURE_DAYS + 1);
    const warnings: string[] = [];

    const [subscribesRes, calendarRes] = await Promise.all([
      mpClient
        .getSubscribes(mpCfg)
        .then((value) => ({ ok: true as const, value }))
        .catch((error: unknown) => ({ ok: false as const, error })),
      mpClient
        .getSubscribeCalendar(mpCfg, { start: startKey, end: endKey, page: 1, count: 200 })
        .then((value) => ({ ok: true as const, value }))
        .catch((error: unknown) => ({ ok: false as const, error })),
    ]);

    if (!subscribesRes.ok) {
      warnings.push(formatMpWarning('获取订阅列表失败', subscribesRes.error));
      logger?.warn(`影视订阅采集失败：${warnings[0]}`);
      return {
        configured: true,
        mock: false,
        checkedAt: new Date(getNow()).toISOString(),
        cached: false,
        calendarAvailable: false,
        warnings,
        items: [],
      };
    }

    let calendarAvailable = true;
    let calendarItemsRaw: Record<string, unknown>[] = [];
    if (calendarRes.ok) {
      calendarItemsRaw = extractCalendarItems(calendarRes.value);
    } else {
      calendarAvailable = false;
      warnings.push('无法获取播出日历');
    }

    const items = buildMediaSubscriptions({
      subscribesRaw: asRecordArray(subscribesRes.value),
      calendarItemsRaw,
      calendarAvailable,
      todayKey,
      toPosterUrl: (rawImg) => toPosterUrl(rawImg, mpCfg.url),
    });

    const finishedAt = getNow();
    const response: MediaSubscriptionsResponse = {
      configured: true,
      mock: false,
      checkedAt: new Date(finishedAt).toISOString(),
      cached: false,
      calendarAvailable,
      warnings,
      items,
    };

    if (cacheSeconds > 0) {
      const ttlSeconds = warnings.length > 0 ? Math.min(cacheSeconds, 10) : cacheSeconds;
      subscriptionsCache = { expiresAtMs: finishedAt + ttlSeconds * 1000, response };
    } else {
      subscriptionsCache = null;
    }

    return response;
  }

  return {
    async getOverview(reqOptions?: { refresh?: boolean }): Promise<MediaOverviewResponse> {
      const refresh = Boolean(reqOptions?.refresh);
      const mpResolved = resolveMpClientConfig();
      if (mpResolved.mock) {
        return collectOverview(refresh);
      }

      const nowMs = getNow();
      if (!refresh && overviewCache && nowMs < overviewCache.expiresAtMs) {
        return { ...overviewCache.response, cached: true };
      }

      if (inFlightOverview) {
        return inFlightOverview;
      }

      inFlightOverview = collectOverview(refresh).finally(() => {
        inFlightOverview = null;
      });
      return inFlightOverview;
    },

    async getDownloads(reqOptions?: { refresh?: boolean }): Promise<MediaDownloadsResponse> {
      const refresh = Boolean(reqOptions?.refresh);
      const mpResolved = resolveMpClientConfig();
      const dlResolved = integrationsStore.resolveDownloadersConfig();
      if (mpResolved.mock || dlResolved.mock) {
        return collectDownloads(refresh);
      }

      const nowMs = getNow();
      if (!refresh && downloadsCache && nowMs < downloadsCache.expiresAtMs) {
        return { ...downloadsCache.response, cached: true };
      }

      if (inFlightDownloads) {
        return inFlightDownloads;
      }

      inFlightDownloads = collectDownloads(refresh).finally(() => {
        inFlightDownloads = null;
      });
      return inFlightDownloads;
    },

    async getSubscriptions(reqOptions?: {
      refresh?: boolean;
    }): Promise<MediaSubscriptionsResponse> {
      const refresh = Boolean(reqOptions?.refresh);
      const mpResolved = resolveMpClientConfig();
      if (mpResolved.mock) {
        return collectSubscriptions();
      }

      const nowMs = getNow();
      if (!refresh && subscriptionsCache && nowMs < subscriptionsCache.expiresAtMs) {
        return { ...subscriptionsCache.response, cached: true };
      }

      if (inFlightSubscriptions) {
        return inFlightSubscriptions;
      }

      inFlightSubscriptions = collectSubscriptions().finally(() => {
        inFlightSubscriptions = null;
      });
      return inFlightSubscriptions;
    },

    invalidateCache(): void {
      overviewCache = null;
      downloadsCache = null;
      subscriptionsCache = null;
    },
  };
}
