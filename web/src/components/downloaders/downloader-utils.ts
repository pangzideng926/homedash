import type { StatusVariant } from '@/components/common';
import type {
  DownloaderActiveTaskState,
  DownloaderInstanceSummary,
  DownloadersSummaryTotals,
  DownloaderTag,
  DownloaderType,
} from '@/lib/api';

export const DOWNLOADER_TAG_OPTIONS: ReadonlyArray<{
  value: DownloaderTag;
  label: string;
  className: string;
}> = [
  {
    value: 'download',
    label: '下载',
    className: 'border-sky-500/25 bg-sky-500/15 text-sky-700 dark:text-sky-400',
  },
  {
    value: 'brush',
    label: '刷流',
    className: 'border-amber-500/25 bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
  {
    value: 'seed',
    label: '保种',
    className: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  },
];

export const DOWNLOADER_TAG_MAP = Object.fromEntries(
  DOWNLOADER_TAG_OPTIONS.map((item) => [item.value, item]),
);

export function getDownloaderTypeLabel(type: DownloaderType): string {
  return type === 'qbittorrent' ? 'qB' : 'TR';
}

export function getDownloaderTypeFullName(type: DownloaderType): string {
  return type === 'qbittorrent' ? 'qBittorrent' : 'Transmission';
}

export function formatTaskProgressPercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress * 1000) / 10));
}

export function formatEta(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const safe = Math.floor(seconds);
  if (safe === 0) {
    return '即将完成';
  }
  if (safe < 60) {
    return `约 ${safe} 秒`;
  }
  if (safe < 3600) {
    return `约 ${Math.floor(safe / 60)} 分`;
  }
  if (safe < 86400) {
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return minutes > 0 ? `约 ${hours} 小时 ${minutes} 分` : `约 ${hours} 小时`;
  }
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  return hours > 0 ? `约 ${days} 天 ${hours} 小时` : `约 ${days} 天`;
}

export function getActiveTaskStatusVariant(state: DownloaderActiveTaskState): StatusVariant {
  if (state === '下载中' || state === '校验中') return 'info';
  if (state === '做种中') return 'success';
  if (state === '出错') return 'error';
  if (state === '卡住' || state === '元数据') return 'warning';
  return 'unknown';
}

export function computeFilteredTotals(
  instances: readonly DownloaderInstanceSummary[],
): DownloadersSummaryTotals {
  const counts = {
    seeding: 0,
    downloading: 0,
    paused: 0,
    error: 0,
    stalled: 0,
    total: 0,
  };
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
