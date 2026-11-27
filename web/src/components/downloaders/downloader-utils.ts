import type { StatusVariant } from '@/components/common';
import type { DownloaderActiveTaskState, DownloaderTag, DownloaderType } from '@/lib/api';

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
