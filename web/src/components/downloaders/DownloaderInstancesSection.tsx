import { Link } from 'react-router';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { StatusBadge } from '@/components/common';
import { formatBytes, formatDateTime, formatSpeed } from '@/components/devices/device-utils';
import {
  DownloaderTagBadge,
  DownloaderTaskStateBadge,
  DownloaderTypeBadge,
} from '@/components/downloaders/downloader-badges';
import { formatEta, formatTaskProgressPercent } from '@/components/downloaders/downloader-utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DownloaderInstanceSummary, DownloadersSummaryTotals } from '@/lib/api';

export interface DownloaderInstancesSectionProps {
  instances: readonly DownloaderInstanceSummary[];
  totals: DownloadersSummaryTotals;
  checkedAt: string;
  mock: boolean;
}

export function DownloaderInstancesSection({
  instances,
  totals,
  checkedAt,
  mock,
}: DownloaderInstancesSectionProps) {
  return (
    <div className="space-y-6">
      {/* 汇总条 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <StatusBadge
          status={
            totals.onlineInstances === totals.totalInstances
              ? 'success'
              : totals.onlineInstances === 0
                ? 'error'
                : 'warning'
          }
          label={`在线实例 ${totals.onlineInstances} / ${totals.totalInstances}`}
        />
        {mock ? <StatusBadge status="info" label="模拟数据" showDot={false} /> : null}
        <span className="flex items-center gap-1 text-foreground">
          <ArrowUp className="size-3.5 text-emerald-500" aria-hidden="true" />
          <span>总上传 {formatSpeed(totals.upSpeed)}</span>
        </span>
        <span className="flex items-center gap-1 text-foreground">
          <ArrowDown className="size-3.5 text-sky-500" aria-hidden="true" />
          <span>总下载 {formatSpeed(totals.dlSpeed)}</span>
        </span>
        <span className="text-muted-foreground">做种 {totals.counts.seeding}</span>
        <span className="text-muted-foreground">总体积 {formatBytes(totals.totalSize)}</span>
        <span className="ml-auto text-muted-foreground">最近更新：{formatDateTime(checkedAt)}</span>
      </div>

      {/* 实例卡片网格 */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {instances.map((inst) => {
          const detailUrl = `/seeding/${encodeURIComponent(inst.id)}`;
          const activeTasks = inst.activeTasks ?? [];
          const previewTasks = activeTasks.slice(0, 3);
          const activeTotal = inst.activeTotal ?? activeTasks.length;
          const remainingCount = Math.max(0, activeTotal - 3);

          return (
            <Card
              key={inst.id}
              className="flex h-full flex-col justify-between transition-colors hover:border-primary/40"
            >
              <Link
                to={detailUrl}
                className="block rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <DownloaderTypeBadge type={inst.type} />
                        <CardTitle className="truncate text-base">{inst.name}</CardTitle>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {inst.tags.map((tag) => (
                          <DownloaderTagBadge key={tag} tag={tag} />
                        ))}
                        {inst.version ? (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {inst.version}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusBadge
                        status={inst.online ? 'success' : 'error'}
                        label={inst.online ? '在线' : '离线'}
                      />
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                  </div>
                  {!inst.online ? (
                    <CardDescription className="text-red-600 dark:text-red-400">
                      {inst.error ?? '下载器连接失败'}
                    </CardDescription>
                  ) : null}
                </CardHeader>

                {inst.online ? (
                  <CardContent className="space-y-3 pb-3 pt-0">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-muted/40 p-2.5">
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ArrowUp className="size-3 text-emerald-500" aria-hidden="true" />
                          <span>上传速度</span>
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-foreground">
                          {formatSpeed(inst.upSpeed)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2.5">
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ArrowDown className="size-3 text-sky-500" aria-hidden="true" />
                          <span>下载速度</span>
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-foreground">
                          {formatSpeed(inst.dlSpeed)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
                      <div>
                        <div className="text-[11px] text-muted-foreground">做种 / 下载</div>
                        <div className="font-semibold text-foreground">
                          {inst.counts.seeding} / {inst.counts.downloading}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">总体积</div>
                        <div className="font-semibold text-foreground">
                          {formatBytes(inst.totalSize)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">出错数</div>
                        <div
                          className={
                            inst.counts.error > 0
                              ? 'flex items-center gap-1 font-semibold text-red-600 dark:text-red-400'
                              : 'font-semibold text-foreground'
                          }
                        >
                          {inst.counts.error > 0 ? (
                            <AlertTriangle className="size-3" aria-hidden="true" />
                          ) : null}
                          <span>{inst.counts.error}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                ) : null}
              </Link>

              <CardContent className="space-y-3 pt-0">
                {inst.online ? (
                  <div className="space-y-2 border-t border-border/60 pt-2.5">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">进行中的任务</span>
                      <span>{activeTotal} 个</span>
                    </div>
                    {previewTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground">暂无进行中的任务</p>
                    ) : (
                      <div className="space-y-2">
                        {previewTasks.map((task, idx) => {
                          const pct = formatTaskProgressPercent(task.progress);
                          return (
                            <div
                              key={`${task.name}-${idx}`}
                              className="space-y-1 rounded-md bg-muted/30 px-2.5 py-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className="min-w-0 truncate font-medium text-foreground"
                                  title={task.name}
                                >
                                  {task.name}
                                </span>
                                <DownloaderTaskStateBadge state={task.state} className="shrink-0" />
                              </div>
                              <div className="flex items-center gap-2">
                                <div
                                  role="progressbar"
                                  aria-label={`${task.name} 进度`}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={pct}
                                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                                >
                                  <div
                                    className="h-full rounded-full bg-sky-500 transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="w-10 shrink-0 text-right text-[11px] font-medium text-foreground">
                                  {pct}%
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                <span>
                                  ↓ {formatSpeed(task.dlSpeed)} · ↑ {formatSpeed(task.upSpeed)}
                                </span>
                                <span>剩余 {formatEta(task.eta)}</span>
                              </div>
                            </div>
                          );
                        })}
                        {remainingCount > 0 ? (
                          <div className="pt-0.5 text-right">
                            <Link
                              to={detailUrl}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              还有 {remainingCount} 个
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                  <span>刷新时间：{formatDateTime(inst.checkedAt)}</span>
                  <span>{inst.cached ? '缓存命中' : '实时采集'}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
