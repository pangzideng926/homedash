import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Database, RotateCw } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import { formatBytes, formatDateTime, formatSpeed } from '@/components/devices/device-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import { fetchQbitSummary } from '@/lib/api';

type GroupTab = 'tracker' | 'category';

export function SeedingPage() {
  const [refreshing, setRefreshing] = useState(false);
  const [groupTab, setGroupTab] = useState<GroupTab>('tracker');

  const fetcher = useCallback((signal: AbortSignal) => fetchQbitSummary({ signal }), []);
  const { data, loading, error, refetch } = useApi(fetcher);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchQbitSummary({ refresh: true });
      await refetch();
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const groupRows = data?.data
    ? groupTab === 'tracker'
      ? data.data.byTracker
      : data.data.byCategory
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="下载与做种"
        description="qBittorrent 只读传输速度、分享率、Tracker/分类做种统计与异常种子排查。"
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
        <LoadingState variant="skeleton" rows={6} message="正在加载下载与做种数据..." />
      ) : error && !data ? (
        <ErrorState
          title="获取下载与做种数据失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data || !data.configured ? (
        <EmptyState
          title="尚未配置 qBittorrent"
          description="请前往设置页填写 qBittorrent WebUI 地址与账号密码，或在环境变量中启用 QBIT_MOCK=true。"
          icon={ArrowUpDown}
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
          title="qBittorrent 连接失败"
          message={data.error ?? '无法连接 qBittorrent WebUI，请检查地址与凭据'}
          onRetry={() => void handleForceRefresh()}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status="success" label="已连接" />
            <StatusBadge status="info" label={`版本 ${data.data.version}`} showDot={false} />
            {data.mock ? <StatusBadge status="info" label="模拟数据" showDot={false} /> : null}
            {data.cached ? <StatusBadge status="unknown" label="缓存命中" showDot={false} /> : null}
            <span>最近采集：{formatDateTime(data.checkedAt)}</span>
          </div>

          {/* 速度卡 + 总量/分享率卡 */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>实时传输速度</span>
                </CardTitle>
                <CardDescription>当前全局实时上传与下载速率</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowUp className="size-3.5 text-emerald-500" aria-hidden="true" />
                    <span>实时上传</span>
                  </div>
                  <div className="mt-1 text-xl font-semibold text-foreground">
                    {formatSpeed(data.data.transfer.upSpeed)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowDown className="size-3.5 text-sky-500" aria-hidden="true" />
                    <span>实时下载</span>
                  </div>
                  <div className="mt-1 text-xl font-semibold text-foreground">
                    {formatSpeed(data.data.transfer.dlSpeed)}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>累计流量与分享率</span>
                  </CardTitle>
                  {data.data.transfer.totalsApproximate ? (
                    <StatusBadge status="warning" label="按种子累计近似" showDot={false} />
                  ) : null}
                </div>
                <CardDescription>全局累计上传/下载量与分享率</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">累计上传</div>
                  <div className="mt-1 text-base font-semibold text-foreground">
                    {formatBytes(data.data.transfer.alltimeUploadBytes)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">累计下载</div>
                  <div className="mt-1 text-base font-semibold text-foreground">
                    {formatBytes(data.data.transfer.alltimeDownloadBytes)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">全局分享率</div>
                  <div className="mt-1 text-base font-semibold text-foreground">
                    {data.data.transfer.globalRatio.toFixed(2)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 状态分组徽章 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                种子状态分布（共 {data.data.counts.total} 个）
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2.5">
              <StatusBadge status="success" label={`做种中 ${data.data.counts.seeding}`} />
              <StatusBadge status="info" label={`下载中 ${data.data.counts.downloading}`} />
              <StatusBadge status="unknown" label={`已暂停 ${data.data.counts.paused}`} />
              <StatusBadge
                status={data.data.counts.stalled > 0 ? 'warning' : 'unknown'}
                label={`卡住 ${data.data.counts.stalled}`}
              />
              <StatusBadge
                status={data.data.counts.error > 0 ? 'error' : 'unknown'}
                label={`出错 ${data.data.counts.error}`}
              />
            </CardContent>
          </Card>

          {/* 按 Tracker / 按分类切换统计表 */}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">做种统计明细</CardTitle>
                <CardDescription>按 Tracker 域名或分类统计做种数与总体积</CardDescription>
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
                  variant={groupTab === 'category' ? 'default' : 'ghost'}
                  onClick={() => setGroupTab('category')}
                >
                  按分类
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {groupRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无分组统计数据</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">
                          {groupTab === 'tracker' ? 'Tracker 域名' : '分类'}
                        </th>
                        <th className="py-2 pr-4 font-medium">做种数</th>
                        <th className="py-2 pr-4 font-medium">总任务数</th>
                        <th className="py-2 font-medium">总体积</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {groupRows.map((row) => (
                        <tr key={row.name}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">{row.name}</td>
                          <td className="py-2.5 pr-4 text-foreground">{row.seedingCount}</td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{row.totalCount}</td>
                          <td className="py-2.5 text-muted-foreground">
                            {formatBytes(row.totalSizeBytes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 问题种子列表 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-amber-500" aria-hidden="true" />
                  <span>出错与无连接种子</span>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  共 {data.data.problemTorrentsTotal} 条
                  {data.data.problemTorrentsTotal > data.data.problemTorrents.length
                    ? `（仅显示前 ${data.data.problemTorrents.length} 条）`
                    : ''}
                </span>
              </div>
              <CardDescription>
                仅用于排查出错、卡住或无连接状态的种子，不提供修改或删除操作。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.data.problemTorrents.length === 0 ? (
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
                        <th className="py-2 pr-4 font-medium">分类</th>
                        <th className="py-2 font-medium">进度</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.data.problemTorrents.map((item) => (
                        <tr key={item.hash}>
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
                            {formatBytes(item.sizeBytes)}
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                            {item.trackerDomain}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{item.category}</td>
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

export default SeedingPage;
