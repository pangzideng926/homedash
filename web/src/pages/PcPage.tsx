import { useCallback, useState } from 'react';
import { Clock, Cpu, HardDrive, MemoryStick, Monitor, RotateCw } from 'lucide-react';
import { ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import { fetchWindowsStatus, type WindowsStatusResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

function formatUptime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function getUsageLevel(percent: number): 'danger' | 'warning' | 'normal' {
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warning';
  return 'normal';
}

function getBarColorClass(percent: number): string {
  const level = getUsageLevel(percent);
  if (level === 'danger') return 'bg-red-500';
  if (level === 'warning') return 'bg-amber-500';
  return 'bg-emerald-500';
}

interface UsageBarProps {
  label: string;
  percent: number;
}

function UsageBar({ label, percent }: UsageBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const level = getUsageLevel(clamped);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      data-level={level}
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn('h-full rounded-full transition-all', getBarColorClass(clamped))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function PcPage() {
  const fetcher = useCallback((signal: AbortSignal) => fetchWindowsStatus({ signal }), []);
  const { data, loading, error, refetch } = useApi(fetcher);
  const [freshData, setFreshData] = useState<WindowsStatusResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const currentData = freshData ?? data;
  const isBusy = loading || refreshing;

  const handleForceRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const next = await fetchWindowsStatus({ refresh: true });
      setFreshData(next);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : '刷新状态失败，请稍后重试');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="家用电脑"
        description="家用 Windows 主机只读状态与硬件资源监控"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleForceRefresh()}
            disabled={isBusy}
          >
            <RotateCw className={isBusy ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
            <span>{refreshing ? '刷新中...' : '刷新'}</span>
          </Button>
        }
      />

      {loading && !currentData ? (
        <LoadingState variant="skeleton" rows={4} message="正在采集家用电脑状态..." />
      ) : (error && !currentData) || refreshError ? (
        <ErrorState
          title="获取家用电脑状态失败"
          message={refreshError ?? error?.message ?? '请求失败，请稍后重试'}
          onRetry={() => void (currentData ? handleForceRefresh() : refetch())}
        />
      ) : !currentData ? (
        <ErrorState
          title="暂无状态数据"
          message="未能获取家用电脑状态"
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <StatusBadge
                  status={currentData.online ? 'success' : 'error'}
                  label={currentData.online ? '在线' : '离线'}
                />
                <StatusBadge
                  status={currentData.cached ? 'info' : 'configured'}
                  label={currentData.cached ? '已缓存' : '实时采集'}
                  showDot={false}
                />
                {currentData.data ? (
                  <span className="text-sm font-medium text-foreground">
                    {currentData.data.hostname}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                上次检查：{formatDateTime(currentData.checkedAt)}
              </div>
            </CardContent>
          </Card>

          {!currentData.online || !currentData.data ? (
            <ErrorState
              title="家用电脑当前离线或采集失败"
              message={currentData.error ?? '无法获取家用电脑运行状态'}
              onRetry={() => void handleForceRefresh()}
            />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">系统信息</CardTitle>
                      <CardDescription>{currentData.data.os}</CardDescription>
                    </div>
                    <Monitor className="size-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">主机名</span>
                      <span className="font-medium text-foreground">
                        {currentData.data.hostname}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="size-3.5" aria-hidden="true" />
                        <span>开机时长</span>
                      </span>
                      <span className="font-medium text-foreground">
                        {formatUptime(currentData.data.uptimeSeconds)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">最近开机时间</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(currentData.data.bootTime)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">处理器与内存</CardTitle>
                      <CardDescription className="truncate">
                        {currentData.data.cpu.model}
                      </CardDescription>
                    </div>
                    <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">CPU 使用率</span>
                        <span className="font-medium text-foreground">
                          {currentData.data.cpu.loadPercent}%
                        </span>
                      </div>
                      <UsageBar label="CPU 使用率" percent={currentData.data.cpu.loadPercent} />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <MemoryStick className="size-3.5" aria-hidden="true" />
                          <span>内存使用率</span>
                        </span>
                        <span className="font-medium text-foreground">
                          {formatBytes(
                            currentData.data.memory.totalBytes - currentData.data.memory.freeBytes,
                          )}{' '}
                          / {formatBytes(currentData.data.memory.totalBytes)} (
                          {currentData.data.memory.usedPercent}%)
                        </span>
                      </div>
                      <UsageBar label="内存使用率" percent={currentData.data.memory.usedPercent} />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">本地磁盘</CardTitle>
                    <CardDescription>仅展示本地固定磁盘（DriveType=3）只读用量</CardDescription>
                  </div>
                  <HardDrive className="size-4 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentData.data.disks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">未检测到本地固定磁盘</p>
                  ) : (
                    currentData.data.disks.map((disk) => {
                      const usedBytes = Math.max(0, disk.totalBytes - disk.freeBytes);
                      const diskTitle = disk.label ? `${disk.drive} (${disk.label})` : disk.drive;
                      return (
                        <div key={disk.drive} className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-medium text-foreground">{diskTitle}</span>
                            <span className="text-xs text-muted-foreground">
                              已用 {formatBytes(usedBytes)} / 总计 {formatBytes(disk.totalBytes)}
                              （可用 {formatBytes(disk.freeBytes)}，{disk.usedPercent}%）
                            </span>
                          </div>
                          <UsageBar label={`${disk.drive} 磁盘使用率`} percent={disk.usedPercent} />
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default PcPage;
