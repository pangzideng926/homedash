import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Bookmark, Download, Film, FolderCheck, Globe, Layers, RotateCw } from 'lucide-react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  type StatusVariant,
} from '@/components/common';
import { formatBytes, formatDateTime, formatSpeed } from '@/components/devices/device-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import { fetchMoviepilotSummary, type MoviepilotActiveDownloadItem } from '@/lib/api';

const MAX_PREVIEW_ITEMS = 5;

function getQueueStateMeta(state: string): { label: string; status: StatusVariant } {
  const lower = state.trim().toLowerCase();
  if (lower === 'waiting' || lower === 'pending') return { label: '等待中', status: 'unknown' };
  if (lower === 'running' || lower === 'transferring' || lower === 'processing') {
    return { label: '整理中', status: 'info' };
  }
  if (lower === 'completed' || lower === 'done' || lower === 'finished' || lower === 'success') {
    return { label: '已完成', status: 'success' };
  }
  if (lower === 'failed' || lower === 'error') return { label: '失败', status: 'error' };
  if (lower === 'cancelled' || lower === 'canceled') return { label: '已取消', status: 'warning' };
  return { label: state || '未知', status: 'unknown' };
}

function getDownloadStateMeta(state: string): { label: string; status: StatusVariant } {
  const lower = state.trim().toLowerCase();
  if (lower === 'downloading') return { label: '下载中', status: 'info' };
  if (lower === 'seeding' || lower === 'uploading') return { label: '做种中', status: 'success' };
  if (lower === 'paused' || lower === 'stopped') return { label: '已暂停', status: 'unknown' };
  if (lower === 'error' || lower === 'failed') return { label: '出错', status: 'error' };
  return { label: state || '未知', status: 'unknown' };
}

function getSubscribeStateLabel(state: string): {
  label: string;
  status: 'success' | 'info' | 'warning' | 'unknown';
} {
  const upper = state.toUpperCase();
  if (upper === 'R') return { label: '订阅中', status: 'info' };
  if (upper === 'N') return { label: '已完成', status: 'success' };
  if (upper === 'S') return { label: '已暂停', status: 'warning' };
  return { label: state || '未知', status: 'unknown' };
}

export function MediaPage() {
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useCallback((signal: AbortSignal) => fetchMoviepilotSummary({ signal }), []);
  const { data, loading, error, refetch } = useApi(fetcher);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchMoviepilotSummary({ refresh: true });
      await refetch();
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="影视"
        description="MoviePilot v3 只读订阅追踪、最近入库记录、正在下载任务与站点健康状态。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleForceRefresh()}
            disabled={loading || refreshing}
          >
            <RotateCw
              className={loading || refreshing ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingState variant="skeleton" rows={6} message="正在加载影视数据..." />
      ) : error && !data ? (
        <ErrorState
          title="获取影视数据失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data || !data.configured ? (
        <EmptyState
          title="尚未配置 MoviePilot"
          description="请前往设置页填写 MoviePilot 服务地址与 API 令牌，或在环境变量中启用 MOVIEPILOT_MOCK=true。"
          icon={Film}
          action={
            <Link
              to="/settings"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              前往设置
            </Link>
          }
        />
      ) : !data.online || !data.data ? (
        <ErrorState
          title="MoviePilot 连接失败"
          message={data.error ?? '无法连接 MoviePilot 服务，请检查地址与 API 令牌'}
          onRetry={() => void handleForceRefresh()}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status="success" label="已连接" />
            {data.mock ? <StatusBadge status="info" label="模拟数据" showDot={false} /> : null}
            {data.cached ? <StatusBadge status="unknown" label="缓存命中" showDot={false} /> : null}
            <span>最近采集：{formatDateTime(data.checkedAt)}</span>
          </div>

          {/* 订阅列表 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bookmark className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>订阅列表（{data.data.subscribes.length}）</span>
              </CardTitle>
              <CardDescription>展示订阅状态、总集数与当前缺集情况</CardDescription>
            </CardHeader>
            <CardContent>
              {data.data.subscribes.length === 0 ? (
                <p className="text-sm text-muted-foreground">当前没有订阅记录</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">名称</th>
                        <th className="py-2 pr-4 font-medium">类型 / 季</th>
                        <th className="py-2 pr-4 font-medium">状态</th>
                        <th className="py-2 pr-4 font-medium">集数 / 缺集</th>
                        <th className="py-2 font-medium">最后更新</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.data.subscribes.map((sub) => {
                        const badge = getSubscribeStateLabel(sub.state);
                        return (
                          <tr key={String(sub.id)}>
                            <td className="py-2.5 pr-4 font-medium text-foreground">
                              {sub.name}
                              {sub.year ? ` (${sub.year})` : ''}
                            </td>
                            <td className="py-2.5 pr-4 text-muted-foreground">
                              {sub.type || '-'}
                              {sub.season !== null ? ` · 第 ${sub.season} 季` : ''}
                            </td>
                            <td className="py-2.5 pr-4">
                              <StatusBadge status={badge.status} label={badge.label} />
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className="text-foreground">{sub.totalEpisode ?? '-'} 集</span>
                              {sub.lackEpisode !== null ? (
                                <span
                                  className={
                                    sub.lackEpisode > 0
                                      ? 'ml-1.5 text-amber-600 dark:text-amber-400'
                                      : 'ml-1.5 text-muted-foreground'
                                  }
                                >
                                  （缺 {sub.lackEpisode} 集）
                                </span>
                              ) : null}
                            </td>
                            <td className="py-2.5 text-muted-foreground">
                              {sub.lastUpdate || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 正在下载 */}
          {(() => {
            const activeDownloads: MoviepilotActiveDownloadItem[] =
              data.data.activeDownloads ??
              data.data.downloads.map((dl, idx) => ({
                hash: `legacy-${idx}`,
                title: dl.title,
                name: dl.name,
                year: '',
                seasonEpisode: '',
                downloader: dl.downloader,
                size: dl.size,
                progress: dl.progress,
                state: dl.state,
                dlSpeedText: formatSpeed(dl.dlSpeed),
                upSpeedText: formatSpeed(dl.upSpeed),
                category: '',
                siteName: dl.siteName,
                leftTime: dl.leftTime,
              }));
            const activeDownloadsTotal = data.data.activeDownloadsTotal ?? activeDownloads.length;
            const visibleDownloads = activeDownloads.slice(0, MAX_PREVIEW_ITEMS);

            return (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Download className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span>正在下载（共 {activeDownloadsTotal} 个）</span>
                    </CardTitle>
                    {activeDownloadsTotal > MAX_PREVIEW_ITEMS ? (
                      <span className="text-xs text-muted-foreground">
                        仅显示前 {MAX_PREVIEW_ITEMS} 条，共 {activeDownloadsTotal} 条
                      </span>
                    ) : null}
                  </div>
                  <CardDescription>
                    只读展示当前下载任务进度、下载器、站点与速度信息
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {visibleDownloads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">当前没有正在下载的任务</p>
                  ) : (
                    <div className="space-y-3">
                      {visibleDownloads.map((dl, idx) => {
                        const stateMeta = getDownloadStateMeta(dl.state);
                        return (
                          <div
                            key={`${dl.hash || dl.name}-${idx}`}
                            className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className="truncate font-medium text-foreground"
                                    title={dl.name || dl.title}
                                  >
                                    {dl.title}
                                  </span>
                                  {dl.seasonEpisode ? (
                                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                                      {dl.seasonEpisode}
                                    </span>
                                  ) : null}
                                  <StatusBadge
                                    status={stateMeta.status}
                                    label={stateMeta.label}
                                    showDot={false}
                                  />
                                </div>
                                <div className="text-muted-foreground">
                                  {[dl.downloader, dl.siteName, dl.category, formatBytes(dl.size)]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                                <span>↓ {dl.dlSpeedText || '0 B/s'}</span>
                                <span>↑ {dl.upSpeedText || '0 B/s'}</span>
                                {dl.leftTime ? <span>剩余 {dl.leftTime}</span> : null}
                                <span className="font-semibold text-foreground">
                                  {dl.progress}%
                                </span>
                              </div>
                            </div>
                            <div
                              role="progressbar"
                              aria-label={`${dl.title} 下载进度`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={dl.progress}
                              className="h-2 w-full overflow-hidden rounded-full bg-muted"
                            >
                              <div
                                className="h-full rounded-full bg-sky-500 transition-all"
                                style={{ width: `${Math.min(100, Math.max(0, dl.progress))}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* 整理队列 */}
          {(() => {
            const queue = data.data.transferQueue ?? { available: true, items: [], total: 0 };
            const queueTotal = data.data.transferQueueTotal ?? queue.total;
            const visibleQueue = queue.items.slice(0, MAX_PREVIEW_ITEMS);

            return (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span>
                        {queue.available ? `整理队列（共 ${queueTotal} 项）` : '整理队列'}
                      </span>
                    </CardTitle>
                    {queue.available && queueTotal > MAX_PREVIEW_ITEMS ? (
                      <span className="text-xs text-muted-foreground">
                        仅显示前 {MAX_PREVIEW_ITEMS} 条，共 {queueTotal} 条
                      </span>
                    ) : null}
                  </div>
                  <CardDescription>
                    只读展示待整理媒体、文件数量、状态计数与部分文件名
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!queue.available ? (
                    <p className="text-sm text-muted-foreground">
                      {queue.reason || '当前 MoviePilot 版本不支持整理队列'}
                    </p>
                  ) : visibleQueue.length === 0 ? (
                    <p className="text-sm text-muted-foreground">当前整理队列为空</p>
                  ) : (
                    <div className="space-y-3">
                      {visibleQueue.map((item, idx) => (
                        <div
                          key={`${item.title}-${item.season}-${idx}`}
                          className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                              <span>
                                {item.title}
                                {item.year ? ` (${item.year})` : ''}
                              </span>
                              {item.season ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                                  {item.season}
                                </span>
                              ) : null}
                            </div>
                            <span className="text-muted-foreground">
                              待整理 {item.taskCount} 个文件
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {Object.entries(item.stateCounts).map(([rawState, count]) => {
                              const meta = getQueueStateMeta(rawState);
                              return (
                                <StatusBadge
                                  key={rawState}
                                  status={meta.status}
                                  label={`${meta.label} ${count}`}
                                  showDot={false}
                                />
                              );
                            })}
                          </div>

                          {item.sampleFiles.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                              {item.sampleFiles.map((fileName, fileIdx) => (
                                <span
                                  key={`${fileName}-${fileIdx}`}
                                  className="max-w-xs truncate rounded bg-background/70 px-2 py-0.5 font-mono"
                                  title={fileName}
                                >
                                  {fileName}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* 最近入库 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>最近入库（{data.data.transfers.length}）</span>
              </CardTitle>
              <CardDescription>最近 20 条整理入库历史与状态</CardDescription>
            </CardHeader>
            <CardContent>
              {data.data.transfers.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无入库历史记录</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">片名</th>
                        <th className="py-2 pr-4 font-medium">类型 / 分类</th>
                        <th className="py-2 pr-4 font-medium">状态</th>
                        <th className="py-2 pr-4 font-medium">备注 / 错误</th>
                        <th className="py-2 font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.data.transfers.map((item, idx) => (
                        <tr key={`${item.title}-${item.date}-${idx}`}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">
                            {item.title}
                            {item.year ? ` (${item.year})` : ''}
                            {item.seasons || item.episodes
                              ? ` ${item.seasons}${item.episodes}`
                              : ''}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {[item.type, item.category].filter(Boolean).join(' · ') || '-'}
                          </td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge
                              status={item.status ? 'success' : 'error'}
                              label={item.status ? '成功' : '失败'}
                            />
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {item.status ? '-' : item.errmsg || '入库失败'}
                          </td>
                          <td className="py-2.5 text-muted-foreground">{item.date || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 站点状态表 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>站点状态（{data.data.sites.length}）</span>
              </CardTitle>
              <CardDescription>
                按站点域名合并统计启用状态、成功/失败次数与耗时（绝不展示 Cookie 或令牌）。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.data.sites.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无站点数据</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">站点名称</th>
                        <th className="py-2 pr-4 font-medium">域名</th>
                        <th className="py-2 pr-4 font-medium">启用状态</th>
                        <th className="py-2 pr-4 font-medium">最近请求</th>
                        <th className="py-2 pr-4 font-medium">成功 / 失败</th>
                        <th className="py-2 pr-4 font-medium">平均耗时</th>
                        <th className="py-2 font-medium">最后时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.data.sites.map((site) => (
                        <tr key={String(site.id)}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">{site.name}</td>
                          <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                            {site.domain || '-'}
                          </td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge
                              status={site.isActive ? 'success' : 'unconfigured'}
                              label={site.isActive ? '已启用' : '已停用'}
                            />
                          </td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge
                              status={
                                site.lastState === 'success'
                                  ? 'success'
                                  : site.lastState === 'fail'
                                    ? 'error'
                                    : 'unknown'
                              }
                              label={
                                site.lastState === 'success'
                                  ? '成功'
                                  : site.lastState === 'fail'
                                    ? '失败'
                                    : '未知'
                              }
                            />
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {site.successCount} / {site.failCount}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {site.avgSeconds !== null ? `${site.avgSeconds}s` : '-'}
                          </td>
                          <td className="py-2.5 text-muted-foreground">
                            {site.lastModDate || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default MediaPage;
