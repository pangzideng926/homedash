import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Database,
  RotateCw,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import { formatBytes, formatDateTime, formatSpeed } from '@/components/devices/device-utils';
import {
  DownloaderTagBadge,
  DownloaderTypeBadge,
} from '@/components/downloaders/downloader-badges';
import { getDownloaderTypeFullName } from '@/components/downloaders/downloader-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import { fetchDownloaderDetail } from '@/lib/api';

type GroupTab = 'tracker' | 'group';

export function DownloaderDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const [groupTab, setGroupTab] = useState<GroupTab>('tracker');

  const fetcher = useCallback((signal: AbortSignal) => fetchDownloaderDetail(id, { signal }), [id]);
  const { data, loading, error, refetch } = useApi(fetcher);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchDownloaderDetail(id, { refresh: true });
      await refetch();
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const isQb = data?.type === 'qbittorrent';
  const secondaryLabel = isQb ? '按分类' : '按标签';
  const secondaryColumnName = isQb ? '分类' : '标签';
  const secondaryStats = isQb ? (data?.byCategory ?? []) : (data?.byLabel ?? []);

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Link
          to="/seeding"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          <span>返回下载与做种</span>
        </Link>
      </div>

      <PageHeader
        title={data ? data.name : '下载器详情'}
        description={
          data
            ? `${getDownloaderTypeFullName(data.type)} 只读传输、状态分组与异常种子排查`
            : '查看单个下载器实例的传输、统计与异常种子信息'
        }
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
        <LoadingState variant="skeleton" rows={6} message="正在加载下载器详情..." />
      ) : error && !data ? (
        <ErrorState
          title="获取下载器详情失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data ? (
        <EmptyState
          title="未找到下载器实例"
          description="该下载器实例不存在或已被移除。"
          icon={ArrowUpDown}
        />
      ) : !data.online ? (
        <ErrorState
          title={`${data.name} 连接失败`}
          message={data.error ?? '无法连接下载器服务，请检查地址与凭据'}
          onRetry={() => void handleForceRefresh()}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <DownloaderTypeBadge type={data.type} />
            {data.tags.map((tag) => (
              <DownloaderTagBadge key={tag} tag={tag} />
            ))}
            <StatusBadge status="success" label="在线" />
            {data.version ? (
              <StatusBadge status="info" label={`版本 ${data.version}`} showDot={false} />
            ) : null}
            {data.cached ? <StatusBadge status="unknown" label="缓存命中" showDot={false} /> : null}
            <span>最近采集：{formatDateTime(data.checkedAt)}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>实时传输速度</span>
                </CardTitle>
                <CardDescription>当前实例实时上传与下载速率</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowUp className="size-3.5 text-emerald-500" aria-hidden="true" />
                    <span>实时上传</span>
                  </div>
                  <div className="mt-1 text-xl font-semibold text-foreground">
                    {formatSpeed(data.upSpeed)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowDown className="size-3.5 text-sky-500" aria-hidden="true" />
                    <span>实时下载</span>
                  </div>
                  <div className="mt-1 text-xl font-semibold text-foreground">
                    {formatSpeed(data.dlSpeed)}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>累计流量与总体积</span>
                  </CardTitle>
                  {data.totalsApproximate ? (
                    <StatusBadge status="warning" label="按种子累计近似" showDot={false} />
                  ) : null}
                </div>
                <CardDescription>累计上传/下载、分享率与当前种子总体积</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">累计上传</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {formatBytes(data.totalUploaded ?? 0)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">累计下载</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {formatBytes(data.totalDownloaded ?? 0)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">分享率</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {(data.ratio ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">种子总体积</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {formatBytes(data.totalSize)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">种子状态分布（共 {data.counts.total} 个）</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2.5">
              <StatusBadge status="success" label={`做种中 ${data.counts.seeding}`} />
              <StatusBadge status="info" label={`下载中 ${data.counts.downloading}`} />
              <StatusBadge status="unknown" label={`已暂停 ${data.counts.paused}`} />
              <StatusBadge
                status={data.counts.stalled > 0 ? 'warning' : 'unknown'}
                label={`卡住 ${data.counts.stalled}`}
              />
              <StatusBadge
                status={data.counts.error > 0 ? 'error' : 'unknown'}
                label={`出错 ${data.counts.error}`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">做种统计明细</CardTitle>
                <CardDescription>
                  按 Tracker 域名或{secondaryColumnName}统计做种数与总体积
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg bg-muted p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={groupTab === 'tracker' ? 'default' : 'ghost'}
                  onClick={() => setGroupTab('tracker')}
                >
                  按 Tracker
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={groupTab === 'group' ? 'default' : 'ghost'}
                  onClick={() => setGroupTab('group')}
                >
                  {secondaryLabel}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {groupTab === 'tracker' ? (
                data.byTracker.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 Tracker 统计数据</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Tracker 域名</th>
                          <th className="py-2 pr-4 font-medium">做种数</th>
                          <th className="py-2 pr-4 font-medium">总任务数</th>
                          <th className="py-2 font-medium">总体积</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {data.byTracker.map((row) => (
                          <tr key={row.domain}>
                            <td className="py-2.5 pr-4 font-medium text-foreground">
                              {row.domain}
                            </td>
                            <td className="py-2.5 pr-4 text-foreground">{row.seedingCount}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{row.count}</td>
                            <td className="py-2.5 text-muted-foreground">
                              {formatBytes(row.size)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : secondaryStats.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无{secondaryColumnName}统计数据</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{secondaryColumnName}</th>
                        <th className="py-2 pr-4 font-medium">做种数</th>
                        <th className="py-2 pr-4 font-medium">总任务数</th>
                        <th className="py-2 font-medium">总体积</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {secondaryStats.map((row) => (
                        <tr key={row.name}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">{row.name}</td>
                          <td className="py-2.5 pr-4 text-foreground">{row.seedingCount}</td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{row.count}</td>
                          <td className="py-2.5 text-muted-foreground">{formatBytes(row.size)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-amber-500" aria-hidden="true" />
                  <span>出错与无连接种子</span>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  共 {data.problemsTotal} 条
                  {data.problemsTotal > data.problems.length
                    ? `（仅显示前 ${data.problems.length} 条）`
                    : ''}
                </span>
              </div>
              <CardDescription>
                仅用于排查出错、卡住或无连接状态的种子，不提供修改或删除操作。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.problems.length === 0 ? (
                <EmptyState
                  title="暂无异常种子"
                  description="当前所有种子状态正常，无出错或无连接任务。"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">种子名称</th>
                        <th className="py-2 pr-4 font-medium">异常原因</th>
                        <th className="py-2 pr-4 font-medium">状态</th>
                        <th className="py-2 pr-4 font-medium">体积</th>
                        <th className="py-2 pr-4 font-medium">Tracker</th>
                        <th className="py-2 pr-4 font-medium">{secondaryColumnName}</th>
                        <th className="py-2 font-medium">进度</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.problems.map((item) => (
                        <tr key={item.id}>
                          <td className="max-w-xs truncate py-2.5 pr-4 font-medium text-foreground">
                            {item.name}
                          </td>
                          <td className="py-2.5 pr-4 text-amber-700 dark:text-amber-400">
                            {item.reason}
                          </td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge
                              status={
                                item.state === 'error' || item.state === 'missingFiles'
                                  ? 'error'
                                  : 'warning'
                              }
                              label={item.state}
                            />
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {formatBytes(item.size)}
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                            {item.trackerDomain}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{item.group}</td>
                          <td className="py-2.5 text-muted-foreground">{item.progress}%</td>
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

export default DownloaderDetailPage;
