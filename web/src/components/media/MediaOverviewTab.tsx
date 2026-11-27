import { ArrowUp, Download, Film, FolderCheck, HardDrive, Layers } from 'lucide-react';
import { EmptyState } from '@/components/common';
import { formatBytes, formatSpeed } from '@/components/devices/device-utils';
import { formatRelativeTime } from '@/components/media/media-utils';
import { PosterImage } from '@/components/media/PosterImage';
import type { MediaOverviewResponse } from '@/lib/api';

export function MediaOverviewTab({ data }: { data: MediaOverviewResponse }) {
  const { stats, recent } = data;

  return (
    <div className="space-y-6">
      {/* 顶部统计条 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>下载中</span>
            <Download className="size-4 text-sky-500" aria-hidden="true" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-foreground">{stats.downloading}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">影视下载实例与 MP 合并去重</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>待整理</span>
            <Layers className="size-4 text-amber-500" aria-hidden="true" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-foreground">
            {stats.pendingTransfer ?? '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {stats.pendingTransfer === null ? '整理队列不可用' : 'MoviePilot 待整理队列'}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>今日入库</span>
            <FolderCheck className="size-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-foreground">
            {stats.todayImported}
            {stats.todayImportedApproximate ? '+' : ''}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {stats.todayImportedApproximate
              ? '近似值（最近 100 条均在今日）'
              : '按展示时区今日成功入库'}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>保种数</span>
            <HardDrive className="size-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-foreground">
            {stats.seeding ?? '—'}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            {stats.seedUploadSpeed !== null ? (
              <span className="inline-flex items-center gap-0.5">
                <ArrowUp className="size-3 text-emerald-500" aria-hidden="true" />
                {formatSpeed(stats.seedUploadSpeed)}
              </span>
            ) : (
              <span>未配置保种实例</span>
            )}
            {stats.seedTotalUploaded !== null ? (
              <span>总上传 {formatBytes(stats.seedTotalUploaded)}</span>
            ) : null}
          </div>
        </div>
      </div>

      {stats.library ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/70 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">媒体库统计</span>
          <span>电影 {stats.library.movieCount} 部</span>
          <span>剧集 {stats.library.tvCount} 部</span>
          <span>总集数 {stats.library.episodeCount} 集</span>
        </div>
      ) : null}

      {/* 最近入库海报墙 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">最近入库</h2>
          <span className="text-xs text-muted-foreground">共 {recent.length} 部</span>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title="暂无最近入库记录"
            description="MoviePilot 整理入库成功的电影与剧集将在此展示海报墙。"
            icon={Film}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {recent.map((item, idx) => {
              const seasonEp = [item.season, item.episodes].filter(Boolean).join(' ');
              return (
                <div
                  key={`${item.title}-${item.season}-${idx}`}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card p-2 transition-colors hover:border-primary/40"
                >
                  <PosterImage src={item.posterUrl} title={item.title} />
                  <div className="mt-2 space-y-1 px-0.5">
                    <div
                      className="truncate text-sm font-medium text-foreground"
                      title={item.year ? `${item.title} (${item.year})` : item.title}
                    >
                      {item.title}
                    </div>
                    <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                      <span className="truncate font-mono">{seasonEp || item.type || '电影'}</span>
                      <span className="shrink-0">
                        {formatRelativeTime(item.importedAt, item.date)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
