import type { DownloaderTag, DownloaderType } from '@/lib/api';

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
