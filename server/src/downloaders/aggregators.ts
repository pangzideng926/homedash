import type { ResolvedDownloaderInstance } from '../integrations/types.js';
import { buildQbitSummaryData, extractTrackerDomain } from '../qbittorrent/service.js';
import type {
  DownloaderGroupStat,
  DownloaderInstanceSummary,
  DownloaderProblemTorrent,
  DownloaderStateCounts,
  DownloadersSummaryTotals,
  DownloaderTrackerStat,
} from './types.js';

const MAX_PROBLEM_TORRENTS = 50;

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
}): DownloaderInstanceSummary {
  const qbitSummary = buildQbitSummaryData({
    version: params.version,
    transferInfo: params.transferInfo,
    maindata: params.maindata,
    torrents: params.torrents,
    categories: params.categories,
  });

  const totalSize = params.torrents.reduce((sum, item) => {
    const size = Math.max(0, toFiniteNumber(item.size ?? item.total_size, 0));
    return sum + size;
  }, 0);

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
  }

  const byTracker = [...trackerMap.values()].sort(
    (a, b) => b.seedingCount - a.seedingCount || b.size - a.size,
  );
  const byLabel = [...labelMap.values()].sort(
    (a, b) => b.seedingCount - a.seedingCount || b.size - a.size,
  );

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
  };
}

/**
 * 生成 3 个模拟下载器实例（qB 下载、qB 刷流、TR 保种），全部使用占位域名与数据。
 */
export function createMockDownloaderSummaries(
  nowMs: number = Date.now(),
): DownloaderInstanceSummary[] {
  const checkedAt = new Date(nowMs).toISOString();
  const gib = 1024 * 1024 * 1024;
  const tib = 1024 * gib;

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
      upSpeed: 6.5 * 1024 * 1024,
      dlSpeed: 12.4 * 1024 * 1024,
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
      upSpeed: 28.2 * 1024 * 1024,
      dlSpeed: 8.6 * 1024 * 1024,
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
      upSpeed: 9.8 * 1024 * 1024,
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
