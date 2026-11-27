import { StatusBadge } from '@/components/common';
import {
  DOWNLOADER_TAG_MAP,
  getActiveTaskStatusVariant,
  getDownloaderTypeLabel,
} from '@/components/downloaders/downloader-utils';
import type { DownloaderActiveTaskState, DownloaderTag, DownloaderType } from '@/lib/api';
import { cn } from '@/lib/utils';

export function DownloaderTypeBadge({
  type,
  className,
}: {
  type: DownloaderType;
  className?: string;
}) {
  const isQb = type === 'qbittorrent';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        isQb
          ? 'border-blue-500/25 bg-blue-500/15 text-blue-700 dark:text-blue-400'
          : 'border-orange-500/25 bg-orange-500/15 text-orange-700 dark:text-orange-400',
        className,
      )}
    >
      {getDownloaderTypeLabel(type)}
    </span>
  );
}

export function DownloaderTagBadge({ tag, className }: { tag: DownloaderTag; className?: string }) {
  const meta = DOWNLOADER_TAG_MAP[tag];
  if (!meta) return null;
  return (
    <StatusBadge status={meta.status} label={meta.label} showDot={false} className={className} />
  );
}

export function DownloaderTaskStateBadge({
  state,
  className,
}: {
  state: DownloaderActiveTaskState;
  className?: string;
}) {
  return (
    <StatusBadge
      status={getActiveTaskStatusVariant(state)}
      label={state}
      showDot={false}
      size="sm"
      className={className}
    />
  );
}
