import type { ResolvedDownloaderInstance } from '../integrations/types.js';
import { buildQbitSummaryData, extractTrackerDomain } from '../qbittorrent/service.js';
import type {
  DownloaderActiveTask,
  DownloaderActiveTaskState,
  DownloaderGroupStat,
  DownloaderInstanceSummary,
  DownloaderProblemTorrent,
  DownloaderStateCounts,
  DownloadersSummaryTotals,
  DownloaderTrackerStat,
} from './types.js';

const MAX_PROBLEM_TORRENTS = 50;
export const DEFAULT_ACTIVE_TASKS_LIMIT = 10;
export const MAX_ACTIVE_TASKS_LIMIT = 100;

interface RankedActiveTask {
  tier: 0 | 1 | 2;
  task: DownloaderActiveTask;
}

export function clampActiveLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_ACTIVE_TASKS_LIMIT;
  }
  const intVal = Math.floor(limit);
  return Math.min(MAX_ACTIVE_TASKS_LIMIT, Math.max(1, intVal));
}

function normalizeProgressFraction(raw: unknown): number {
  const num = toFiniteNumber(raw, 0);
  const clamped = Math.min(1, Math.max(0, num));
  return Math.round(clamped * 10000) / 10000;
}

function normalizeRatio(raw: unknown): number {
  const num = toFiniteNumber(raw, 0);
  if (num <= 0) return 0;
  return Math.round(num * 100) / 100;
}

export function normalizeQbitEta(raw: unknown): number | null {
  const num = toFiniteNumber(raw, Number.NaN);
  if (!Number.isFinite(num) || num < 0 || num >= 8640000) {
    return null;
  }
  return Math.floor(num);
}

export function normalizeTransmissionEta(raw: unknown): number | null {
  const num = toFiniteNumber(raw, Number.NaN);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return Math.floor(num);
}

function sortRankedActiveTasks(entries: RankedActiveTask[]): DownloaderActiveTask[] {
  return [...entries]
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.task.dlSpeed - a.task.dlSpeed ||
        b.task.upSpeed - a.task.upSpeed ||
        a.task.name.localeCompare(b.task.name),
    )
    .map((entry) => entry.task);
}

function classifyQbitActiveTask(
  t: Record<string, unknown>,
  dlSpeed: number,
  upSpeed: number,
): { state: DownloaderActiveTaskState; tier: 0 | 1 | 2 } | null {
  const rawState = toNonEmptyString(t.state, 'unknown');
  const hasTraffic = dlSpeed > 0 || upSpeed > 0;

  if (rawState === 'error' || rawState === 'missingFiles') {
    return { state: '出错', tier: 0 };
  }
  if (rawState === 'metaDL' || rawState === 'forcedMetaDL') {
    return { state: '元数据', tier: 1 };
  }
  if (rawState === 'stalledDL') {
    return { state: '卡住', tier: 1 };
  }
  if (rawState === 'queuedDL') {
    return { state: '等待', tier: 1 };
  }
  if (rawState === 'checkingDL' || rawState === 'checkingUP' || rawState === 'checkingResumeData') {
    return { state: '校验中', tier: 1 };
  }
  if (rawState === 'downloading' || rawState === 'forcedDL' || rawState === 'allocating') {
    return { state: '下载中', tier: 1 };
  }
  if (rawState === 'uploading' || rawState === 'stalledUP' || rawState === 'forcedUP') {
    return hasTraffic ? { state: '做种中', tier: 2 } : null;
  }
  if (rawState === 'queuedUP') {
    return hasTraffic ? { state: '等待', tier: 2 } : null;
  }
  if (
    rawState === 'pausedDL' ||
    rawState === 'pausedUP' ||
    rawState === 'stoppedDL' ||
    rawState === 'stoppedUP'
  ) {
    return hasTraffic ? { state: '已暂停', tier: 2 } : null;
  }

  if (dlSpeed > 0) {
    return { state: '下载中', tier: 1 };
  }
  if (upSpeed > 0) {
    return { state: '做种中', tier: 2 };
  }
  return null;
}

function classifyTransmissionActiveTask(
  status: number,
  isError: boolean,
  isStalled: boolean,
  dlSpeed: number,
  upSpeed: number,
): { state: DownloaderActiveTaskState; tier: 0 | 1 | 2 } | null {
  const hasTraffic = dlSpeed > 0 || upSpeed > 0;

  if (isError) {
    return { state: '出错', tier: 0 };
  }
  if (status === 1 || status === 3) {
    return { state: '等待', tier: 1 };
  }
  if (status === 2) {
    return { state: '校验中', tier: 1 };
  }
  if (status === 4) {
    return { state: isStalled ? '卡住' : '下载中', tier: 1 };
  }
  if (status === 5) {
    return hasTraffic ? { state: '等待', tier: 2 } : null;
  }
  if (status === 6) {
    return hasTraffic ? { state: '做种中', tier: 2 } : null;
  }
  if (status === 0) {
    return hasTraffic ? { state: '已暂停', tier: 2 } : null;
  }

  if (dlSpeed > 0) {
    return { state: '下载中', tier: 1 };
  }
  if (upSpeed > 0) {
    return { state: '做种中', tier: 2 };
  }
  return null;
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

export function createEmptyStateCounts(): DownloaderStateCounts {
  return {
    seeding: 0,
    downloading: 0,
    paused: 0,
    error: 0,
    stalled: 0,
    total: 0,
  };
}

/**
 * 将 qBittorrent 原始数据转换为统一多实例下载器汇总结构。
 */
export function buildQbitInstanceSummary(params: {
  instance: ResolvedDownloaderInstance;
  checkedAt: string;
  cached: boolean;
  version: string;
  transferInfo: Record<string, unknown>;
  maindata: Record<string, unknown> | null;
  torrents: Array<Record<string, unknown>>;
  categories: Record<string, unknown>;
  activeLimit?: number;
}): DownloaderInstanceSummary {
  const qbitSummary = buildQbitSummaryData({
    version: params.version,
    transferInfo: params.transferInfo,
    maindata: params.maindata,
    torrents: params.torrents,
    categories: params.categories,
  });

  const rankedActive: RankedActiveTask[] = [];
  let totalSize = 0;
  for (const item of params.torrents) {
    const size = Math.max(0, toFiniteNumber(item.size ?? item.total_size, 0));
    totalSize += size;

    const dlSpeed = Math.max(0, toFiniteNumber(item.dlspeed, 0));
    const upSpeed = Math.max(0, toFiniteNumber(item.upspeed, 0));
    const classified = classifyQbitActiveTask(item, dlSpeed, upSpeed);
    if (!classified) continue;

    const category = toNonEmptyString(item.category, '');
    rankedActive.push({
      tier: classified.tier,
      task: {
        name: toNonEmptyString(item.name, '未命名种子'),
        state: classified.state,
        progress: normalizeProgressFraction(item.progress),
        dlSpeed,
        upSpeed,
        eta: normalizeQbitEta(item.eta),
        size,
        ratio: normalizeRatio(item.ratio),
        ...(category ? { category } : {}),
      },
    });
  }

  const sortedActive = sortRankedActiveTasks(rankedActive);
  const limit = clampActiveLimit(params.activeLimit);

  return {
    id: params.instance.id,
    name: params.instance.name,
    type: 'qbittorrent',
    tags: [...params.instance.tags],
    online: true,
    checkedAt: params.checkedAt,
    cached: params.cached,
    version: qbitSummary.version,
    upSpeed: qbitSummary.transfer.upSpeed,
    dlSpeed: qbitSummary.transfer.dlSpeed,
    totalUploaded: qbitSummary.transfer.alltimeUploadBytes,
    totalDownloaded: qbitSummary.transfer.alltimeDownloadBytes,
    ratio: qbitSummary.transfer.globalRatio,
    totalsApproximate: qbitSummary.transfer.totalsApproximate,
    counts: {
      seeding: qbitSummary.counts.seeding,
      downloading: qbitSummary.counts.downloading,
      paused: qbitSummary.counts.paused,
      error: qbitSummary.counts.error,
      stalled: qbitSummary.counts.stalled,
      total: qbitSummary.counts.total,
    },
    totalSize,
    byTracker: qbitSummary.byTracker.map((item) => ({
      domain: item.name,
      count: item.totalCount,
      seedingCount: item.seedingCount,
      size: item.totalSizeBytes,
    })),
    byCategory: qbitSummary.byCategory.map((item) => ({
      name: item.name,
      count: item.totalCount,
      seedingCount: item.seedingCount,
      size: item.totalSizeBytes,
    })),
    problems: qbitSummary.problemTorrents.map((item) => ({
      id: item.hash,
      name: item.name,
      state: item.state,
      reason: item.reason,
      size: item.sizeBytes,
      trackerDomain: item.trackerDomain,
      group: item.category,
      progress: item.progress,
    })),
    problemsTotal: qbitSummary.problemTorrentsTotal,
    activeTasks: sortedActive.slice(0, limit),
    activeTotal: sortedActive.length,
  };
}

function extractTransmissionTrackerDomain(torrent: Record<string, unknown>): string {
  const candidates: unknown[] = [];
  if (Array.isArray(torrent.trackerStats) && torrent.trackerStats.length > 0) {
    const first = torrent.trackerStats[0] as { announce?: unknown } | undefined;
    candidates.push(first?.announce);
  }
  if (Array.isArray(torrent.trackers) && torrent.trackers.length > 0) {
    const first = torrent.trackers[0] as { announce?: unknown } | undefined;
    candidates.push(first?.announce);
  }
  for (const candidate of candidates) {
    const domain = extractTrackerDomain(candidate);
    if (domain !== '无 Tracker') {
      return domain;
    }
  }
  return '无 Tracker';
}

function getTransmissionStatusLabel(status: number, hasError: boolean, stalled: boolean): string {
  if (hasError) return 'error';
  if (stalled) return 'stalled';
  if (status === 5 || status === 6) return 'seeding';
  if (status === 3 || status === 4) return 'downloading';
  if (status === 1 || status === 2) return 'checking';
  if (status === 0) return 'stopped';
  return 'unknown';
}

/**
 * 将 Transmission RPC 原始数据转换为统一多实例下载器汇总结构。
 */
export function buildTransmissionInstanceSummary(params: {
  instance: ResolvedDownloaderInstance;
  checkedAt: string;
  cached: boolean;
  session: Record<string, unknown>;
  stats: Record<string, unknown>;
  torrents: Array<Record<string, unknown>>;
  activeLimit?: number;
}): DownloaderInstanceSummary {
  const version = toNonEmptyString(params.session.version, '未知版本');
  const upSpeed = Math.max(0, toFiniteNumber(params.stats.uploadSpeed, 0));
  const dlSpeed = Math.max(0, toFiniteNumber(params.stats.downloadSpeed, 0));

  const cumulativeStats =
    typeof params.stats['cumulative-stats'] === 'object' &&
    params.stats['cumulative-stats'] !== null
      ? (params.stats['cumulative-stats'] as Record<string, unknown>)
      : null;

  let totalUploaded = 0;
  let totalDownloaded = 0;
  let totalsApproximate = false;

  if (
    cumulativeStats &&
    cumulativeStats.uploadedBytes !== undefined &&
    cumulativeStats.downloadedBytes !== undefined
  ) {
    totalUploaded = Math.max(0, toFiniteNumber(cumulativeStats.uploadedBytes, 0));
    totalDownloaded = Math.max(0, toFiniteNumber(cumulativeStats.downloadedBytes, 0));
  } else {
    totalsApproximate = true;
    for (const t of params.torrents) {
      totalUploaded += Math.max(0, toFiniteNumber(t.uploadedEver, 0));
      totalDownloaded += Math.max(0, toFiniteNumber(t.downloadedEver, 0));
    }
  }

  const ratio = totalDownloaded > 0 ? Math.round((totalUploaded / totalDownloaded) * 100) / 100 : 0;

  const counts: DownloaderStateCounts = {
    seeding: 0,
    downloading: 0,
    paused: 0,
    error: 0,
    stalled: 0,
    total: params.torrents.length,
  };

  let totalSize = 0;
  const trackerMap = new Map<string, DownloaderTrackerStat>();
  const labelMap = new Map<string, DownloaderGroupStat>();
  const allProblems: DownloaderProblemTorrent[] = [];
  const rankedActive: RankedActiveTask[] = [];

  for (let i = 0; i < params.torrents.length; i += 1) {
    const t = params.torrents[i]!;
    const id = String(t.id ?? i + 1);
    const name = toNonEmptyString(t.name, '未命名种子');
    const status = toFiniteNumber(t.status, -1);
    const size = Math.max(0, toFiniteNumber(t.totalSize ?? t.sizeWhenDone, 0));
    totalSize += size;
    const progress = Math.min(
      100,
      Math.max(0, Math.round(toFiniteNumber(t.percentDone, 0) * 1000) / 10),
    );
    const rateDownload = Math.max(0, toFiniteNumber(t.rateDownload, 0));
    const rateUpload = Math.max(0, toFiniteNumber(t.rateUpload, 0));
    const peersConnected = Math.max(0, toFiniteNumber(t.peersConnected, 0));
    const errorCode = toFiniteNumber(t.error, 0);
    const errorString = toNonEmptyString(t.errorString, '');
    const isError = errorCode !== 0;
    const isDownloading = status === 3 || status === 4;
    const isSeeding = status === 5 || status === 6;
    const isPaused = status === 0;
    const isStalled =
      Boolean(t.isStalled) || (isDownloading && rateDownload === 0 && peersConnected === 0);

    if (isError) {
      counts.error += 1;
    } else if (isSeeding) {
      counts.seeding += 1;
    } else if (isDownloading) {
      counts.downloading += 1;
    } else if (isPaused) {
      counts.paused += 1;
    }

    if (!isError && isStalled) {
      counts.stalled += 1;
    }

    const trackerDomain = extractTransmissionTrackerDomain(t);
    const trackerStat = trackerMap.get(trackerDomain) ?? {
      domain: trackerDomain,
      count: 0,
      seedingCount: 0,
      size: 0,
    };
    trackerStat.count += 1;
    if (!isError && isSeeding) {
      trackerStat.seedingCount += 1;
    }
    trackerStat.size += size;
    trackerMap.set(trackerDomain, trackerStat);

    const rawLabels = Array.isArray(t.labels)
      ? t.labels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
      : [];
    const labels = rawLabels.length > 0 ? rawLabels.map((l) => l.trim()) : ['无标签'];
    for (const label of labels) {
      const groupStat = labelMap.get(label) ?? {
        name: label,
        count: 0,
        seedingCount: 0,
        size: 0,
      };
      groupStat.count += 1;
      if (!isError && isSeeding) {
        groupStat.seedingCount += 1;
      }
      groupStat.size += size;
      labelMap.set(label, groupStat);
    }

    let problemReason: string | null = null;
    if (isError) {
      problemReason = errorString ? `出错：${errorString}` : '种子出错';
    } else if (isStalled) {
      problemReason = '任务卡住（无可用连接）';
    }

    if (problemReason) {
      allProblems.push({
        id,
        name,
        state: getTransmissionStatusLabel(status, isError, isStalled),
        reason: problemReason,
        size,
        trackerDomain,
        group: labels.join(', '),
        progress,
      });
    }

    const classified = classifyTransmissionActiveTask(
      status,
      isError,
      isStalled,
      rateDownload,
      rateUpload,
    );
    if (classified) {
      const labelText = rawLabels.map((l) => l.trim()).join(', ');
      rankedActive.push({
        tier: classified.tier,
        task: {
          name,
          state: classified.state,
          progress: normalizeProgressFraction(t.percentDone),
          dlSpeed: rateDownload,
          upSpeed: rateUpload,
          eta: normalizeTransmissionEta(t.eta),
          size,
          ratio: normalizeRatio(t.uploadRatio),
          ...(labelText ? { label: labelText } : {}),
        },
      });
    }
  }

  const byTracker = [...trackerMap.values()].sort(
    (a, b) => b.seedingCount - a.seedingCount || b.size - a.size,
  );
  const byLabel = [...labelMap.values()].sort(
    (a, b) => b.seedingCount - a.seedingCount || b.size - a.size,
  );
  const sortedActive = sortRankedActiveTasks(rankedActive);
  const limit = clampActiveLimit(params.activeLimit);

  return {
    id: params.instance.id,
    name: params.instance.name,
    type: 'transmission',
    tags: [...params.instance.tags],
    online: true,
    checkedAt: params.checkedAt,
    cached: params.cached,
    version,
    upSpeed,
    dlSpeed,
    totalUploaded,
    totalDownloaded,
    ratio,
    totalsApproximate,
    counts,
    totalSize,
    byTracker,
    byLabel,
    problems: allProblems.slice(0, MAX_PROBLEM_TORRENTS),
    problemsTotal: allProblems.length,
    activeTasks: sortedActive.slice(0, limit),
    activeTotal: sortedActive.length,
  };
}

/**
 * 生成 3 个模拟下载器实例（qB 下载、qB 刷流、TR 保种），全部使用占位域名与数据。
 */
export function createMockDownloaderSummaries(
  nowMs: number = Date.now(),
  activeLimit?: number,
): DownloaderInstanceSummary[] {
  const checkedAt = new Date(nowMs).toISOString();
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;
  const tib = 1024 * gib;
  const limit = clampActiveLimit(activeLimit);

  const qbDownloadTasks: DownloaderActiveTask[] = [
    {
      name: 'Demo.Movie.2025.2160p.UHD.BluRay.x265.HDR10-GroupA',
      state: '下载中',
      progress: 0.72,
      dlSpeed: 8.2 * mib,
      upSpeed: 1.4 * mib,
      eta: 4800,
      size: 42.5 * gib,
      ratio: 0.18,
      category: 'movies',
    },
    {
      name: 'Demo.Series.2026.S02E08.1080p.WEB-DL.H264-GroupB',
      state: '下载中',
      progress: 0.41,
      dlSpeed: 4.2 * mib,
      upSpeed: 0.6 * mib,
      eta: 1500,
      size: 6.4 * gib,
      ratio: 0.09,
      category: 'tv',
    },
    {
      name: 'Demo.Documentary.2025.2160p.WEB-DL-GroupC',
      state: '元数据',
      progress: 0,
      dlSpeed: 0,
      upSpeed: 0,
      eta: null,
      size: 12.0 * gib,
      ratio: 0,
      category: 'tv',
    },
    {
      name: 'Demo.Movie.2025.2160p.WEB-DL',
      state: '卡住',
      progress: 0.642,
      dlSpeed: 0,
      upSpeed: 0,
      eta: null,
      size: 18.5 * gib,
      ratio: 0.12,
      category: 'movies',
    },
    {
      name: 'Demo.Classic.Film.2020.1080p.BluRay-GroupD',
      state: '做种中',
      progress: 1,
      dlSpeed: 0,
      upSpeed: 4.5 * mib,
      eta: null,
      size: 16.0 * gib,
      ratio: 2.35,
      category: 'movies',
    },
  ];

  const qbBrushTasks: DownloaderActiveTask[] = [
    {
      name: 'Demo.Pack.2024.1080p.BluRay',
      state: '出错',
      progress: 1,
      dlSpeed: 0,
      upSpeed: 0,
      eta: null,
      size: 42 * gib,
      ratio: 3.1,
      category: 'freeleech',
    },
    {
      name: 'Demo.Freeleech.Pack.2026.2160p.Remux',
      state: '下载中',
      progress: 0.56,
      dlSpeed: 6.1 * mib,
      upSpeed: 18.4 * mib,
      eta: 3200,
      size: 64 * gib,
      ratio: 1.45,
      category: 'freeleech',
    },
    {
      name: 'Demo.FLAC.Collection.2025.Lossless',
      state: '下载中',
      progress: 0.85,
      dlSpeed: 2.5 * mib,
      upSpeed: 5.2 * mib,
      eta: 420,
      size: 4.8 * gib,
      ratio: 2.1,
      category: 'music',
    },
  ];

  const trSeedTasks: DownloaderActiveTask[] = [
    {
      name: 'Demo.Archive.Remux.2023.2160p.BluRay',
      state: '做种中',
      progress: 1,
      dlSpeed: 0,
      upSpeed: 6.4 * mib,
      eta: null,
      size: 58 * gib,
      ratio: 6.8,
      label: 'remux',
    },
    {
      name: 'Demo.Archive.Boxset.2022.1080p',
      state: '做种中',
      progress: 1,
      dlSpeed: 0,
      upSpeed: 3.4 * mib,
      eta: null,
      size: 92 * gib,
      ratio: 4.15,
      label: 'archive',
    },
  ];

  return [
    {
      id: 'mock-qb-download',
      name: 'qB 下载',
      type: 'qbittorrent',
      tags: ['download'],
      online: true,
      checkedAt,
      cached: false,
      version: 'v5.0.2 (mock)',
      upSpeed: 6.5 * mib,
      dlSpeed: 12.4 * mib,
      totalUploaded: 4.8 * tib,
      totalDownloaded: 3.2 * tib,
      ratio: 1.5,
      totalsApproximate: false,
      counts: {
        seeding: 14,
        downloading: 3,
        paused: 2,
        error: 0,
        stalled: 1,
        total: 20,
      },
      totalSize: 640 * gib,
      byTracker: [
        { domain: 'pt-alpha.example.com', count: 12, seedingCount: 9, size: 380 * gib },
        { domain: 'pt-beta.example.com', count: 8, seedingCount: 5, size: 260 * gib },
      ],
      byCategory: [
        { name: 'movies', count: 11, seedingCount: 8, size: 390 * gib },
        { name: 'tv', count: 9, seedingCount: 6, size: 250 * gib },
      ],
      problems: [
        {
          id: 'mock-dl-1',
          name: 'Demo.Movie.2025.2160p.WEB-DL',
          state: 'stalledDL',
          reason: '下载卡住（无可用连接）',
          size: 18.5 * gib,
          trackerDomain: 'pt-alpha.example.com',
          group: 'movies',
          progress: 64.2,
        },
      ],
      problemsTotal: 1,
      activeTasks: qbDownloadTasks.slice(0, limit),
      activeTotal: qbDownloadTasks.length,
    },
    {
      id: 'mock-qb-brush',
      name: 'qB 刷流',
      type: 'qbittorrent',
      tags: ['brush'],
      online: true,
      checkedAt,
      cached: false,
      version: 'v5.0.2 (mock)',
      upSpeed: 28.2 * mib,
      dlSpeed: 8.6 * mib,
      totalUploaded: 32.5 * tib,
      totalDownloaded: 7.4 * tib,
      ratio: 4.39,
      totalsApproximate: false,
      counts: {
        seeding: 26,
        downloading: 2,
        paused: 1,
        error: 1,
        stalled: 0,
        total: 30,
      },
      totalSize: 1.45 * tib,
      byTracker: [
        { domain: 'pt-gamma.example.com', count: 18, seedingCount: 16, size: 920 * gib },
        { domain: 'pt-alpha.example.com', count: 12, seedingCount: 10, size: 560 * gib },
      ],
      byCategory: [
        { name: 'freeleech', count: 24, seedingCount: 21, size: 1.2 * tib },
        { name: 'music', count: 6, seedingCount: 5, size: 250 * gib },
      ],
      problems: [
        {
          id: 'mock-brush-1',
          name: 'Demo.Pack.2024.1080p.BluRay',
          state: 'missingFiles',
          reason: '文件缺失',
          size: 42 * gib,
          trackerDomain: 'pt-gamma.example.com',
          group: 'freeleech',
          progress: 100,
        },
      ],
      problemsTotal: 1,
      activeTasks: qbBrushTasks.slice(0, limit),
      activeTotal: qbBrushTasks.length,
    },
    {
      id: 'mock-tr-seed',
      name: 'TR 保种',
      type: 'transmission',
      tags: ['seed'],
      online: true,
      checkedAt,
      cached: false,
      version: '4.0.6 (mock)',
      upSpeed: 9.8 * mib,
      dlSpeed: 0,
      totalUploaded: 18.2 * tib,
      totalDownloaded: 2.1 * tib,
      ratio: 8.67,
      totalsApproximate: false,
      counts: {
        seeding: 128,
        downloading: 0,
        paused: 4,
        error: 0,
        stalled: 0,
        total: 132,
      },
      totalSize: 5.8 * tib,
      byTracker: [
        { domain: 'pt-alpha.example.com', count: 72, seedingCount: 70, size: 3.1 * tib },
        { domain: 'pt-beta.example.com', count: 60, seedingCount: 58, size: 2.7 * tib },
      ],
      byLabel: [
        { name: 'archive', count: 90, seedingCount: 88, size: 4.2 * tib },
        { name: 'remux', count: 42, seedingCount: 40, size: 1.6 * tib },
      ],
      problems: [],
      problemsTotal: 0,
      activeTasks: trSeedTasks.slice(0, limit),
      activeTotal: trSeedTasks.length,
    },
  ];
}

export function computeDownloadersTotals(
  instances: readonly DownloaderInstanceSummary[],
): DownloadersSummaryTotals {
  const counts = createEmptyStateCounts();
  let onlineInstances = 0;
  let upSpeed = 0;
  let dlSpeed = 0;
  let totalSize = 0;

  for (const item of instances) {
    if (item.online) {
      onlineInstances += 1;
    }
    upSpeed += item.upSpeed;
    dlSpeed += item.dlSpeed;
    totalSize += item.totalSize;
    counts.seeding += item.counts.seeding;
    counts.downloading += item.counts.downloading;
    counts.paused += item.counts.paused;
    counts.error += item.counts.error;
    counts.stalled += item.counts.stalled;
    counts.total += item.counts.total;
  }

  return {
    totalInstances: instances.length,
    onlineInstances,
    offlineInstances: instances.length - onlineInstances,
    upSpeed,
    dlSpeed,
    totalSize,
    counts,
  };
}

/**
 * 生成模拟 qBittorrent 原始种子列表（用于影视模块在 DOWNLOADERS_MOCK=true 时的联调与测试）。
 */
export function createMockQbitTorrents(instanceId: string): Array<Record<string, unknown>> {
  if (instanceId !== 'mock-qb-download') {
    return [];
  }
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;
  return [
    {
      hash: 'demo-mp-dl-1',
      name: 'Demo.Series.Alpha.S02E11.2160p.WEB-DL',
      state: 'downloading',
      progress: 0.725,
      dlspeed: 12.5 * mib,
      upspeed: 1.8 * mib,
      eta: 360,
      size: 6.4 * gib,
      ratio: 0.18,
      category: 'tv',
    },
    {
      hash: 'demo-qb-unmatched-1',
      name: '[ExamplePT].Demo.Movie.2025.2160p.UHD.BluRay.x265',
      state: 'downloading',
      progress: 0.41,
      dlspeed: 4.2 * mib,
      upspeed: 0.6 * mib,
      eta: 1500,
      size: 42.5 * gib,
      ratio: 0.09,
      category: 'movies',
    },
    {
      hash: 'demo-qb-seeding-done-1',
      name: 'Demo.Classic.Film.2020.1080p.BluRay-GroupD',
      state: 'uploading',
      progress: 1,
      dlspeed: 0,
      upspeed: 4.5 * mib,
      eta: 8640000,
      size: 16.0 * gib,
      ratio: 2.35,
      category: 'movies',
    },
  ];
}
