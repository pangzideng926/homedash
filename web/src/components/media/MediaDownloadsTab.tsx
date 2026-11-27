import { Download } from 'lucide-react';
import { EmptyState, StatusBadge } from '@/components/common';
import { formatBytes, formatSpeed } from '@/components/devices/device-utils';
import { formatEta, formatTaskProgressPercent } from '@/components/downloaders/downloader-utils';
import { getMediaDownloadStateVariant } from '@/components/media/media-utils';
import { PosterImage } from '@/components/media/PosterImage';
import type { MediaDownloadsResponse } from '@/lib/api';

export function MediaDownloadsTab({ data }: { data: MediaDownloadsResponse }) {
  if (data.items.length === 0) {
    return (
      <EmptyState
        title="当前没有下载任务"
        description="带「下载」标签的 qBittorrent 与 MoviePilot 当前均无未完成下载任务。"
        icon={Download}
      />
    );
  }

  return (
    <div className="space-y-3">
      {data.items.map((item, idx) => {
        const pct = formatTaskProgressPercent(item.progress);
        const dlText =
          item.dlSpeed !== null ? formatSpeed(item.dlSpeed) : (item.dlSpeedText ?? '0 B/s');
        const upText =
          item.upSpeed !== null ? formatSpeed(item.upSpeed) : (item.upSpeedText ?? '0 B/s');
        const etaText = item.eta !== null ? formatEta(item.eta) : (item.leftTime ?? '—');

        return (
          <div
            key={`${item.hash || item.torrentName}-${idx}`}
            className="flex gap-3.5 rounded-xl border border-border bg-card p-3.5"
          >
            <div className="w-14 shrink-0">
              <PosterImage src={item.posterUrl} title={item.displayName} textClassName="text-lg" />
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="truncate text-sm font-semibold text-foreground"
                      title={item.torrentName}
                    >
                      {item.displayName}
                    </span>
                    {item.year ? (
                      <span className="text-xs text-muted-foreground">({item.year})</span>
                    ) : null}
                    {item.seasonEpisode ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                        {item.seasonEpisode}
                      </span>
                    ) : null}
                    {!item.matched ? (
                      <StatusBadge status="warning" label="未识别" showDot={false} />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{item.instanceName}</span>
                    {item.site ? <span>· {item.site}</span> : null}
                    {item.size > 0 ? <span>· {formatBytes(item.size)}</span> : null}
                  </div>
                </div>

                <StatusBadge status={getMediaDownloadStateVariant(item.state)} label={item.state} />
              </div>

              <div className="flex items-center gap-2.5">
                <div
                  role="progressbar"
                  aria-label={`${item.displayName} 下载进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-xs font-semibold text-foreground">
                  {pct}%
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  ↓ {dlText} · ↑ {upText}
                </span>
                <span>剩余 {etaText}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
