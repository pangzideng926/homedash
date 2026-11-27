import { ArrowUp, Download, Film, FolderCheck, HardDrive, Layers } from 'lucide-react';
import { CardGrid, DataCard, EmptyState } from '@/components/common';
import { formatBytes, formatSpeed } from '@/components/devices/device-utils';
import { formatRelativeTime } from '@/components/media/media-utils';
import { PosterImage } from '@/components/media/PosterImage';
import type { MediaOverviewResponse } from '@/lib/api';

export function MediaOverviewTab({ data }: { data: MediaOverviewResponse }) {
  const { stats, recent } = data;

  return (
    <div className="space-y-6">
      {/* 顶部统计条 */}
      <CardGrid columns={4}>
        <DataCard
          compact
          title="下载中"
          value={stats.downloading}
          icon={Download}
          iconClassName="text-sky-500"
          footer="影视下载实例与 MP 合并去重"
        />

        <DataCard
          compact
          title="待整理"
          value={stats.pendingTransfer ?? '—'}
          icon={Layers}
          iconClassName="text-amber-500"
          footer={stats.pendingTransfer === null ? '整理队列不可用' : 'MoviePilot 待整理队列'}
        />

        <DataCard
          compact
          title="今日入库"
          value={`${stats.todayImported}${stats.todayImportedApproximate ? '+' : ''}`}
          icon={FolderCheck}
          iconClassName="text-emerald-500"
          footer={
            stats.todayImportedApproximate
              ? '近似值（最近 100 条均在今日）'
              : '按展示时区今日成功入库'
          }
        />

        <DataCard
          compact
          title="保种数"
          value={stats.seeding ?? '—'}
          icon={HardDrive}
          iconClassName="text-emerald-500"
          footer={
            <div className="flex flex-wrap items-center gap-x-2">
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
          }
        />
      </CardGrid>

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
