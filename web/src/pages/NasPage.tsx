import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import {
  Container,
  Cpu,
  HardDrive,
  MemoryStick,
  RotateCw,
  Server,
  Thermometer,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import { formatBytes, formatDateTime, formatUptime } from '@/components/devices/device-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import { fetchNasStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

function getTempVariant(tempC: number): 'error' | 'warning' | 'success' {
  if (tempC >= 85) return 'error';
  if (tempC >= 70) return 'warning';
  return 'success';
}

function getVolumeLevel(percent: number): 'danger' | 'warning' | 'normal' {
  if (percent >= 90) return 'danger';
  if (percent >= 80) return 'warning';
  return 'normal';
}

function getBarClassByThreshold(percent: number, warnAt: number, dangerAt: number): string {
  if (percent >= dangerAt) return 'bg-red-500';
  if (percent >= warnAt) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function NasPage() {
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useCallback((signal: AbortSignal) => fetchNasStatus({ signal }), []);
  const { data, loading, error, refetch } = useApi(fetcher);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchNasStatus({ refresh: true });
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
        title="NAS"
        description="Linux NAS 只读硬件状态、传感器温度、RAID 阵列、存储卷与 Docker 容器监控。"
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
        <LoadingState variant="skeleton" rows={6} message="正在采集 NAS 状态..." />
      ) : error && !data ? (
        <ErrorState
          title="获取 NAS 状态失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data || !data.configured ? (
        <EmptyState
          title="尚未配置 NAS"
          description="请前往设置页填写 NAS SSH 连接参数，或在环境变量中启用 NAS_MOCK=true。"
          icon={Server}
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
          title="NAS 离线或采集失败"
          message={data.error ?? '无法连接 NAS，请检查 SSH 配置与主机状态'}
          onRetry={() => void handleForceRefresh()}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status="success" label="在线" />
            {data.mock ? <StatusBadge status="info" label="模拟数据" showDot={false} /> : null}
            {data.cached ? <StatusBadge status="unknown" label="缓存命中" showDot={false} /> : null}
            <span>最近采集：{formatDateTime(data.checkedAt)}</span>
          </div>

          {/* 系统信息与 CPU/内存 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Server className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>系统信息</span>
                  </CardTitle>
                  <span className="font-mono text-xs text-muted-foreground">
                    {data.data.hostname}
                  </span>
                </div>
                <CardDescription>{data.data.osVersion}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">运行时长</div>
                  <div className="mt-1 font-semibold text-foreground">
                    {formatUptime(data.data.uptimeSeconds)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">平均负载（1 / 5 / 15 分钟）</div>
                  <div className="mt-1 font-mono font-semibold text-foreground">
                    {data.data.loadAvg.map((v) => v.toFixed(2)).join(' / ')}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>CPU 与内存</span>
                </CardTitle>
                <CardDescription>
                  {data.data.cpu.model}（{data.data.cpu.cores} 核）
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Cpu className="size-3.5" aria-hidden="true" />
                      <span>CPU 使用率</span>
                    </span>
                    <span className="font-medium text-foreground">
                      {data.data.cpu.loadPercent}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="CPU 使用率"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={data.data.cpu.loadPercent}
                    className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        getBarClassByThreshold(data.data.cpu.loadPercent, 75, 90),
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(0, data.data.cpu.loadPercent))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MemoryStick className="size-3.5" aria-hidden="true" />
                      <span>
                        内存（{formatBytes(data.data.memory.usedBytes)} /{' '}
                        {formatBytes(data.data.memory.totalBytes)}）
                      </span>
                    </span>
                    <span className="font-medium text-foreground">
                      {data.data.memory.usedPercent}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="内存使用率"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={data.data.memory.usedPercent}
                    className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        getBarClassByThreshold(data.data.memory.usedPercent, 80, 90),
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(0, data.data.memory.usedPercent))}%`,
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 温度卡 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Thermometer className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>传感器温度</span>
                </CardTitle>
                {data.data.maxTemperatureC !== null ? (
                  <StatusBadge
                    status={getTempVariant(data.data.maxTemperatureC)}
                    label={`最高 ${data.data.maxTemperatureC}℃`}
                  />
                ) : null}
              </div>
              <CardDescription>
                {data.data.smart.available
                  ? `已读取 ${data.data.smart.disks.length} 块硬盘 SMART 温度`
                  : `硬盘 SMART 温度：${data.data.smart.reason ?? '已跳过'}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.data.temperatures.length === 0 && !data.data.smart.available ? (
                <p className="text-sm text-muted-foreground">暂无可用温度传感器数据</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {data.data.temperatures.map((group) => (
                    <div
                      key={group.category}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
                    >
                      <div>
                        <div className="text-xs font-medium text-foreground">{group.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {group.sensors.length} 个测点
                        </div>
                      </div>
                      <StatusBadge
                        status={getTempVariant(group.maxTempC)}
                        label={`${group.maxTempC}℃`}
                        showDot={false}
                      />
                    </div>
                  ))}
                  {data.data.smart.available
                    ? data.data.smart.disks.map((disk) => (
                        <div
                          key={disk.device}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs font-medium text-foreground">
                              {disk.device}
                            </div>
                            {disk.model ? (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {disk.model}
                              </div>
                            ) : null}
                          </div>
                          <StatusBadge
                            status={getTempVariant(disk.tempC)}
                            label={`${disk.tempC}℃`}
                            showDot={false}
                          />
                        </div>
                      ))
                    : null}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 存储卡（RAID + 卷） */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>存储与 RAID 阵列</span>
              </CardTitle>
              <CardDescription>展示软件 RAID 阵列健康度及挂载卷容量使用情况。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {data.data.raids.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">RAID 阵列</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {data.data.raids.map((raid) => (
                      <div
                        key={raid.name}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-foreground">
                              {raid.name}
                            </span>
                            <span className="text-xs uppercase text-muted-foreground">
                              {raid.level}
                            </span>
                            {raid.stateFlags ? (
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                {raid.stateFlags}
                              </code>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            成员：{raid.members.join(', ')}
                          </div>
                        </div>
                        <StatusBadge
                          status={raid.healthy ? 'success' : 'error'}
                          label={raid.statusLabel}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground">存储卷</h3>
                {data.data.volumes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">未检测到可用存储卷</p>
                ) : (
                  <div className="space-y-3">
                    {data.data.volumes.map((vol) => {
                      const level = getVolumeLevel(vol.usedPercent);
                      return (
                        <div key={vol.mount} className="space-y-1.5 rounded-lg bg-muted/30 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-foreground">
                                {vol.mount}
                              </span>
                              <span className="text-muted-foreground">
                                {vol.device} · {vol.fsType}
                              </span>
                            </div>
                            <span className="font-medium text-foreground">
                              已用 {formatBytes(vol.usedBytes)} / {formatBytes(vol.totalBytes)}
                              （可用 {formatBytes(vol.availableBytes)}，{vol.usedPercent}%）
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`${vol.mount} 使用率`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={vol.usedPercent}
                            data-level={level}
                            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                getBarClassByThreshold(vol.usedPercent, 80, 90),
                              )}
                              style={{
                                width: `${Math.min(100, Math.max(0, vol.usedPercent))}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Docker 卡 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Container className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>Docker 容器</span>
              </CardTitle>
              <CardDescription>只读列出宿主机上的 Docker 容器状态。</CardDescription>
            </CardHeader>
            <CardContent>
              {!data.data.docker.available ? (
                <EmptyState
                  title="Docker 信息不可用"
                  description={data.data.docker.reason ?? '无法获取 Docker 容器列表'}
                  icon={Container}
                />
              ) : data.data.docker.containers.length === 0 ? (
                <EmptyState
                  title="暂无容器"
                  description="当前宿主机上没有任何 Docker 容器。"
                  icon={Container}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">容器名称</th>
                        <th className="py-2 pr-4 font-medium">镜像</th>
                        <th className="py-2 pr-4 font-medium">状态</th>
                        <th className="py-2 pr-4 font-medium">运行时长</th>
                        <th className="py-2 font-medium">端口映射</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.data.docker.containers.map((c) => (
                        <tr key={c.id}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">{c.name}</td>
                          <td className="py-2.5 pr-4 font-mono text-muted-foreground">{c.image}</td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge
                              status={
                                c.state === 'running'
                                  ? 'success'
                                  : c.state === 'exited' || c.state === 'dead'
                                    ? 'error'
                                    : 'warning'
                              }
                              label={c.status || c.state}
                            />
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {c.runningFor || '-'}
                          </td>
                          <td className="py-2.5 font-mono text-muted-foreground">
                            {c.ports || '-'}
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

export default NasPage;
