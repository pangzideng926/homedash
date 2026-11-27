import { Bookmark, CalendarClock } from 'lucide-react';
import { CardGrid, EmptyState, StatusBadge } from '@/components/common';
import {
  formatMissingEpisodesBadge,
  formatNextAirLabel,
  getMediaSubscribeStateVariant,
  getMovieAvailabilityBadge,
  isMovieSubscription,
} from '@/components/media/media-utils';
import { PosterImage } from '@/components/media/PosterImage';
import { Card } from '@/components/ui/card';
import type { MediaSubscriptionsResponse } from '@/lib/api';

export function MediaSubscriptionsTab({ data }: { data: MediaSubscriptionsResponse }) {
  if (data.items.length === 0) {
    return (
      <EmptyState
        title="暂无订阅记录"
        description="在 MoviePilot 添加电影或剧集订阅后，将在此展示追更进度、缺集提示与排期。"
        icon={Bookmark}
      />
    );
  }

  return (
    <CardGrid columns={3}>
      {data.items.map((item) => {
        const isMovie = isMovieSubscription(item);
        const missingLabel = formatMissingEpisodesBadge(item.missingEpisodes, 6);
        const movieBadge = isMovie ? getMovieAvailabilityBadge(item) : null;
        const latestEp = item.latestEpisode ?? item.completedEpisode ?? 0;

        return (
          <Card key={String(item.id)} className="flex min-w-0 gap-3 p-3.5 sm:gap-3.5">
            <div className="w-16 shrink-0 sm:w-20">
              <PosterImage src={item.posterUrl} title={item.name} />
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div className="space-y-1.5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3
                      className="break-words text-sm font-semibold text-foreground sm:truncate"
                      title={item.name}
                    >
                      {item.name}
                      {item.year ? ` (${item.year})` : ''}
                    </h3>
                    <div className="text-xs text-muted-foreground">
                      {item.type}
                      {item.season !== null ? ` · 第 ${item.season} 季` : ''}
                    </div>
                  </div>
                  <StatusBadge
                    status={getMediaSubscribeStateVariant(item.state)}
                    label={item.state}
                  />
                </div>

                {isMovie && movieBadge ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      status={movieBadge.status}
                      label={movieBadge.label}
                      showDot={false}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-xs text-foreground">
                      已更新到第 {latestEp} 集 / 共 {item.totalEpisode ?? '?'} 集
                    </div>
                    {missingLabel ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status="warning" label={missingLabel} showDot={false} />
                        {item.missingInferred ? (
                          <span className="text-[11px] text-muted-foreground">（推断）</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {isMovie ? '上映：' : '下一集：'}
                  {formatNextAirLabel(item.nextAir)}
                </span>
              </div>
            </div>
          </Card>
        );
      })}
    </CardGrid>
  );
}
