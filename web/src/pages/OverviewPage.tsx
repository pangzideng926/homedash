import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Download,
  Film,
  Flame,
  HardDrive,
  Layers,
  RotateCw,
  Server,
} from 'lucide-react';
import {
  CardGrid,
  DataCard,
  EmptyState,
  ErrorState,
  ExpiryCountdown,
  LoadingState,
  PageHeader,
  ProgressBar,
  SectionCard,
  StatusBadge,
  type StatusVariant,
} from '@/components/common';
import { DeviceOsIcon } from '@/components/devices/DeviceOsIcon';
import { formatDateTime, formatSpeed } from '@/components/devices/device-utils';
import {
  DownloaderTagBadge,
  DownloaderTypeBadge,
} from '@/components/downloaders/downloader-badges';
import { formatVpsCardTitle } from '@/components/vps/vps-utils';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/useApi';
import { useStatusPolling } from '@/hooks/useStatusPolling';
import {
  fetchDevicesStatus,
  fetchDownloadersSummary,
  fetchMoviepilotSummary,
  fetchNasStatus,
  fetchVpsList,
  type DetectedOs,
  type DevicesStatusResponse,
  type DeviceStatusItem,
  type NasStatusResponse,
  type VpsListResponse,
} from '@/lib/api';
import { formatLastUpdated } from '@/lib/status-refresh';
import {
  collectOverviewAnomalies,
  computeMediaDownloadOverview,
  getHighestDeviceDisk,
  getHighestNasVolume,
  getNearestVpsServers,
  groupHomeDevicesByOs,
} from '@/pages/overview-utils';

function getGroupStatusBadge(devices: readonly DeviceStatusItem[]): {
  status: StatusVariant;
  label: string;
} {
  if (devices.length === 0) {
    return { status: 'unconfigured', label: '未配置' };
  }
  const onlineCount = devices.filter((d) => d.online).length;
  if (onlineCount === devices.length) {
    return {
      status: 'online',
      label: devices.length === 1 ? '在线' : `${onlineCount}/${devices.length} 在线`,
    };
  }
  if (onlineCount === 0) {
    return {
      status: 'offline',
      label: devices.length === 1 ? '离线' : `0/${devices.length} 在线`,
    };
  }
  return {
    status: 'warning',
    label: `${onlineCount}/${devices.length} 在线`,
  };
}

interface DeviceGroupCardProps {
  title: string;
  os: DetectedOs;
  devices: readonly DeviceStatusItem[];
  loading: boolean;
  error: Error | null;
  data: DevicesStatusResponse | null;
  nowMs: number;
  onRetry: () => void;
}

function getLatestDeviceCheckedAt(
  devices: readonly DeviceStatusItem[],
  fallbackCheckedAt?: string | null,
): string | null {
  let latestMs = -1;
  let latestIso: string | null = null;
  for (const dev of devices) {
    const ts = Date.parse(dev.checkedAt);
    if (Number.isFinite(ts) && ts > latestMs) {
      latestMs = ts;
      latestIso = dev.checkedAt;
    }
  }
  return latestIso ?? fallbackCheckedAt ?? null;
}

function DeviceGroupCard({
  title,
  os,
  devices,
  loading,
  error,
  data,
  nowMs,
  onRetry,
}: DeviceGroupCardProps) {
  const icon = (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
      <DeviceOsIcon os={os} className="size-4" />
    </div>
  );

  if (loading && !data) {
    return (
      <SectionCard leading={icon} title={title}>
        <LoadingState
          variant="skeleton"
          rows={1}
          columns={1}
          compact
          message={`正在加载 ${title} 状态...`}
        />
      </SectionCard>
    );
  }

  if (error && !data) {
    return (
      <SectionCard
        leading={icon}
        title={title}
        actions={
          <Link to="/devices" className="text-xs font-medium text-primary hover:underline">
            查看设备
          </Link>
        }
      >
        <ErrorState
          compact
          title={`获取 ${title} 状态失败`}
          message={error.message}
          onRetry={onRetry}
        />
      </SectionCard>
    );
  }

  if (!data || !data.configured || data.errorCode === 'UNCONFIGURED') {
    return (
      <Link
        to="/devices"
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SectionCard
          interactive
          leading={icon}
          title={title}
          actions={<StatusBadge status="unconfigured" label="未配置" />}
        >
          <EmptyState
            compact
            hideIcon
            title={`暂未配置 ${title} 设备`}
            description="点击前往家用设备管理页"
          />
        </SectionCard>
      </Link>
    );
  }

  if (data.error) {
    return (
      <SectionCard
        leading={icon}
        title={title}
        actions={
          <Link to="/devices" className="text-xs font-medium text-primary hover:underline">
            查看设备
          </Link>
        }
      >
        <ErrorState compact title="设备清单读取失败" message={data.error} onRetry={onRetry} />
      </SectionCard>
    );
  }

  if (devices.length === 0) {
    return (
      <Link
        to="/devices"
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SectionCard
          interactive
          leading={icon}
          title={title}
          actions={<StatusBadge status="unconfigured" label="未配置" />}
        >
          <EmptyState
            compact
            hideIcon
            title={`暂无 ${title} 设备`}
            description="点击前往家用设备页查看"
          />
        </SectionCard>
      </Link>
    );
  }

  const badge = getGroupStatusBadge(devices);
  const groupCheckedAt = getLatestDeviceCheckedAt(devices, data.checkedAt);

  return (
    <Link
      to="/devices"
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SectionCard
        interactive
        className="h-full"
        leading={icon}
        title={title}
        subtitle={
          devices.length === 1
            ? devices[0]?.name
            : `共 ${devices.length} 台 · ${devices.filter((d) => d.online).length} 台在线`
        }
        actions={
          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            <StatusBadge status={badge.status} label={badge.label} />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        }
        footer={
          groupCheckedAt ? (
            <div className="flex min-w-0 w-full flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
              <span title={formatDateTime(groupCheckedAt)}>
                {formatLastUpdated(groupCheckedAt, nowMs)}
              </span>
            </div>
          ) : undefined
        }
      >
        {devices.length === 1 && devices[0] ? (
          (() => {
            const dev = devices[0];
            if (!dev.online || !dev.data) {
              return (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {dev.error ?? '设备离线或无法连接'}
                </p>
              );
            }
            const topDisk = getHighestDeviceDisk(dev.data.disks);
            return (
              <div className="space-y-2.5">
                <ProgressBar
                  ariaLabel={`${dev.name} CPU`}
                  label="CPU"
                  valueText={`${dev.data.cpu.loadPercent}%`}
                  value={dev.data.cpu.loadPercent}
                  size="sm"
                />
                <ProgressBar
                  ariaLabel={`${dev.name} 内存`}
                  label="内存"
                  valueText={`${dev.data.memory.usedPercent}%`}
                  value={dev.data.memory.usedPercent}
                  size="sm"
                />
                {topDisk ? (
                  <ProgressBar
                    ariaLabel={`${dev.name} 磁盘 ${topDisk.mount}`}
                    label={`磁盘 (${topDisk.mount})`}
                    valueText={`${topDisk.usedPercent}%`}
                    value={topDisk.usedPercent}
                    size="sm"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">暂无磁盘数据</p>
                )}
              </div>
            );
          })()
        ) : (
          <ul className="space-y-2.5">
            {devices.map((dev) => {
              const topDisk = dev.data ? getHighestDeviceDisk(dev.data.disks) : null;
              return (
                <li
                  key={dev.id}
                  className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {dev.name}
                    </span>
                    <StatusBadge size="sm" status={dev.online ? 'online' : 'offline'} />
                  </div>
                  {dev.online && dev.data ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                      <span>CPU {dev.data.cpu.loadPercent}%</span>
                      <span>内存 {dev.data.memory.usedPercent}%</span>
                      {topDisk ? (
                        <span>
                          磁盘({topDisk.mount}) {topDisk.usedPercent}%
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="truncate text-[11px] text-red-600 dark:text-red-400">
                      {dev.error ?? '设备离线'}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </Link>
  );
}

function NasOverviewCard({
  data,
  loading,
  error,
  nowMs,
  onRetry,
}: {
  data: NasStatusResponse | null;
  loading: boolean;
  error: Error | null;
  nowMs: number;
  onRetry: () => void;
}) {
  if (loading && !data) {
    return (
      <SectionCard icon={HardDrive} title="NAS">
        <LoadingState
          variant="skeleton"
          rows={1}
          columns={1}
          compact
          message="正在加载 NAS 状态..."
        />
      </SectionCard>
    );
  }

  if (error && !data) {
    return (
      <SectionCard
        icon={HardDrive}
        title="NAS"
        actions={
          <Link to="/nas" className="text-xs font-medium text-primary hover:underline">
            查看 NAS
          </Link>
        }
      >
        <ErrorState compact title="获取 NAS 状态失败" message={error.message} onRetry={onRetry} />
      </SectionCard>
    );
  }

  if (!data || !data.configured) {
    return (
      <Link
        to="/nas"
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SectionCard
          interactive
          icon={HardDrive}
          title="NAS"
          actions={<StatusBadge status="unconfigured" label="未配置" />}
        >
          <EmptyState
            compact
            hideIcon
            title="暂未配置 NAS"
            description="点击进入 NAS 或前往设置页配置"
          />
        </SectionCard>
      </Link>
    );
  }

  if (!data.online || !data.data) {
    return (
      <Link
        to="/nas"
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SectionCard
          interactive
          icon={HardDrive}
          title="NAS"
          actions={
            <div className="flex items-center gap-1.5">
              <StatusBadge status="offline" />
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
          }
        >
          <p className="text-xs text-red-600 dark:text-red-400">{data.error ?? 'NAS 连接失败'}</p>
        </SectionCard>
      </Link>
    );
  }

  const nas = data.data;
  const topVolume = getHighestNasVolume(nas.volumes);

  return (
    <Link
      to="/nas"
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SectionCard
        interactive
        className="h-full"
        icon={HardDrive}
        title="NAS"
        subtitle={nas.hostname}
        actions={
          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            <StatusBadge status="online" />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        }
        footer={
          <div className="flex min-w-0 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-2">
            <span>
              {nas.maxTemperatureC !== null
                ? `最高温度 ${nas.maxTemperatureC}℃`
                : '温度传感器不可用'}
            </span>
            {nas.raids.length > 0 ? (
              <span>
                RAID {nas.raids.filter((r) => r.healthy).length}/{nas.raids.length} 正常
              </span>
            ) : null}
            <span title={formatDateTime(data.checkedAt)}>
              {formatLastUpdated(data.checkedAt, nowMs)}
            </span>
          </div>
        }
      >
        <div className="space-y-2.5">
          <ProgressBar
            ariaLabel="NAS CPU"
            label="CPU"
            valueText={`${nas.cpu.loadPercent}%`}
            value={nas.cpu.loadPercent}
            warnThreshold={75}
            dangerThreshold={90}
            size="sm"
          />
          <ProgressBar
            ariaLabel="NAS 内存"
            label="内存"
            valueText={`${nas.memory.usedPercent}%`}
            value={nas.memory.usedPercent}
            warnThreshold={80}
            dangerThreshold={90}
            size="sm"
          />
          {topVolume ? (
            <ProgressBar
              ariaLabel={`NAS 磁盘 ${topVolume.mount}`}
              label={`磁盘 (${topVolume.mount})`}
              valueText={`${topVolume.usedPercent}%`}
              value={topVolume.usedPercent}
              warnThreshold={80}
              dangerThreshold={90}
              size="sm"
            />
          ) : (
            <p className="text-xs text-muted-foreground">暂无挂载卷数据</p>
          )}
        </div>
      </SectionCard>
    </Link>
  );
}

function VpsNearestSection({
  data,
  loading,
  error,
  onRetry,
}: {
  data: VpsListResponse | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const nearestServers =
    data?.configured && !data.error ? getNearestVpsServers(data.servers, 3) : [];

  return (
    <SectionCard
      icon={Server}
      title="VPS 最近到期"
      subtitle={
        data?.configured && !data.error
          ? `共 ${data.summary.total} 台 · 7 天内到期 ${data.summary.within7Days} 台`
          : '云服务器续费与到期倒计时'
      }
      actions={
        <Link
          to="/vps"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <span>查看全部</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {loading && !data ? (
        <LoadingState
          variant="skeleton"
          rows={2}
          columns={1}
          compact
          message="正在加载 VPS 到期清单..."
        />
      ) : error && !data ? (
        <ErrorState compact title="加载 VPS 列表失败" message={error.message} onRetry={onRetry} />
      ) : !data || !data.configured || data.errorCode === 'UNCONFIGURED' ? (
        <EmptyState compact hideIcon title="尚未配置 VPS 清单" description="点击查看全部前往配置" />
      ) : data.error ? (
        <ErrorState compact title="VPS 清单文件读取失败" message={data.error} onRetry={onRetry} />
      ) : nearestServers.length === 0 ? (
        <EmptyState compact hideIcon title="暂无 VPS 记录" description="可在 VPS 页面添加服务器" />
      ) : (
        <div className="space-y-2.5">
          {nearestServers.map((server) => (
            <Link
              key={server.id}
              to="/vps"
              className="block rounded-lg border border-border/70 bg-muted/20 p-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {formatVpsCardTitle(server.name, server.region)}
                  </div>
                  {server.provider ? (
                    <div className="truncate text-xs text-muted-foreground">{server.provider}</div>
                  ) : null}
                </div>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <ExpiryCountdown
                size="sm"
                daysLeft={server.daysLeft}
                level={server.level}
                expiresAt={server.expiresAt}
                error={server.error}
              />
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function OverviewPage() {
  const forceRefreshRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingInfra, setRefreshingInfra] = useState(false);

  const devicesFetcher = useCallback(
    ({ refresh, signal }: { refresh: boolean; signal: AbortSignal }) =>
      fetchDevicesStatus({ refresh, signal }),
    [],
  );
  const nasFetcher = useCallback(
    ({ refresh, signal }: { refresh: boolean; signal: AbortSignal }) =>
      fetchNasStatus({ refresh, signal }),
    [],
  );
  const vpsFetcher = useCallback((signal: AbortSignal) => fetchVpsList(signal), []);
  const downloadersFetcher = useCallback(
    (signal: AbortSignal) => fetchDownloadersSummary({ refresh: forceRefreshRef.current, signal }),
    [],
  );
  const mpFetcher = useCallback(
    (signal: AbortSignal) => fetchMoviepilotSummary({ refresh: forceRefreshRef.current, signal }),
    [],
  );

  const devicesState = useStatusPolling<DevicesStatusResponse>({
    topic: 'devices',
    fetcher: devicesFetcher,
    getUpdatedAt: (res) => res.checkedAt,
  });
  const nasState = useStatusPolling<NasStatusResponse>({
    topic: 'nas',
    fetcher: nasFetcher,
    getUpdatedAt: (res) => res.checkedAt,
  });
  const vpsState = useApi(vpsFetcher);
  const downloadersState = useApi(downloadersFetcher);
  const mpState = useApi(mpFetcher);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    forceRefreshRef.current = true;
    try {
      await Promise.all([
        devicesState.refresh(),
        nasState.refresh(),
        vpsState.refetch(),
        downloadersState.refetch(),
        mpState.refetch(),
      ]);
    } finally {
      forceRefreshRef.current = false;
      setRefreshing(false);
    }
  };

  const handleRefreshDevicesAndNas = async () => {
    setRefreshingInfra(true);
    try {
      await Promise.all([devicesState.refresh(), nasState.refresh()]);
    } finally {
      setRefreshingInfra(false);
    }
  };

  const latestInfraUpdatedAt = (() => {
    const candidates = [devicesState.lastUpdatedAt, nasState.lastUpdatedAt].filter(
      (item): item is string => Boolean(item),
    );
    if (candidates.length === 0) return null;
    let latest = candidates[0]!;
    let latestTs = Date.parse(latest);
    for (const item of candidates.slice(1)) {
      const ts = Date.parse(item);
      if (Number.isFinite(ts) && (!Number.isFinite(latestTs) || ts > latestTs)) {
        latest = item;
        latestTs = ts;
      }
    }
    return latest;
  })();
  const infraNowMs = Math.max(devicesState.nowMs, nasState.nowMs);

  const anyInitialLoading =
    (devicesState.loading && !devicesState.data) ||
    (nasState.loading && !nasState.data) ||
    (vpsState.loading && !vpsState.data) ||
    (downloadersState.loading && !downloadersState.data) ||
    (mpState.loading && !mpState.data);

  const allInitialLoading =
    devicesState.loading &&
    !devicesState.data &&
    nasState.loading &&
    !nasState.data &&
    vpsState.loading &&
    !vpsState.data &&
    downloadersState.loading &&
    !downloadersState.data &&
    mpState.loading &&
    !mpState.data;

  const groupedDevices = groupHomeDevicesByOs(
    devicesState.data?.configured && !devicesState.data.error ? devicesState.data.devices : [],
  );

  const anomalies = collectOverviewAnomalies({
    devicesData: devicesState.data,
    devicesError: devicesState.error,
    nasData: nasState.data,
    nasError: nasState.error,
    vpsData: vpsState.data,
    vpsError: vpsState.error,
    downloadersData: downloadersState.data,
    downloadersError: downloadersState.error,
  });

  const mediaOverview = computeMediaDownloadOverview(downloadersState.data, mpState.data);
  const mediaInitialLoading =
    downloadersState.loading && !downloadersState.data && mpState.loading && !mpState.data;
  const mediaHasError =
    (Boolean(downloadersState.error) && !downloadersState.data) ||
    (Boolean(mpState.error) && !mpState.data);
  const mediaUnconfigured =
    !mediaInitialLoading &&
    !mediaHasError &&
    !mediaOverview.hasDownloaders &&
    !mediaOverview.hasMoviepilot;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="总览"
        description="集中查看家用设备、NAS、VPS 到期、影视下载概况与异常提示。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleRefreshAll()}
            disabled={refreshing || anyInitialLoading}
          >
            <RotateCw
              className={refreshing ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden="true"
            />
            <span>{refreshing ? '刷新中...' : '刷新'}</span>
          </Button>
        }
      />

      {/* 异常提示区 */}
      <SectionCard
        leading={
          anomalies.length > 0 ? (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </div>
          ) : (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" aria-hidden="true" />
            </div>
          )
        }
        title="异常提示"
        subtitle="汇总设备离线、VPS 7 天内到期、磁盘 ≥ 90% 与下载器连接异常"
        actions={
          allInitialLoading ? undefined : anomalies.length > 0 ? (
            <StatusBadge status="danger" label={`${anomalies.length} 项异常`} />
          ) : (
            <StatusBadge status="success" label="运行正常" />
          )
        }
      >
        {allInitialLoading ? (
          <LoadingState
            variant="skeleton"
            rows={1}
            columns={1}
            compact
            message="正在检查异常状态..."
          />
        ) : anomalies.length === 0 ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
            暂无异常
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {anomalies.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusBadge
                      size="sm"
                      status={item.severity === 'error' ? 'danger' : 'warning'}
                      label={item.categoryLabel}
                    />
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                  </div>
                  <p className="break-words text-xs text-muted-foreground sm:truncate">
                    {item.detail}
                  </p>
                </div>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 设备区：Windows / Mac / NAS */}
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">设备与 NAS 状态</span>
            {latestInfraUpdatedAt ? (
              <span title={formatDateTime(latestInfraUpdatedAt)}>
                {formatLastUpdated(latestInfraUpdatedAt, infraNowMs)}
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleRefreshDevicesAndNas()}
            disabled={
              refreshing || refreshingInfra || devicesState.refreshing || nasState.refreshing
            }
          >
            <RotateCw
              className={
                refreshingInfra || devicesState.refreshing || nasState.refreshing
                  ? 'size-3.5 animate-spin'
                  : 'size-3.5'
              }
              aria-hidden="true"
            />
            <span>
              {refreshingInfra || devicesState.refreshing || nasState.refreshing
                ? '刷新中...'
                : '刷新设备与 NAS'}
            </span>
          </Button>
        </div>

        <CardGrid columns={3}>
          <DeviceGroupCard
            title="Windows"
            os="windows"
            devices={groupedDevices.windows}
            loading={devicesState.loading}
            error={devicesState.error}
            data={devicesState.data}
            nowMs={devicesState.nowMs}
            onRetry={() => void devicesState.refetch()}
          />

          <DeviceGroupCard
            title="Mac"
            os="macos"
            devices={groupedDevices.macos}
            loading={devicesState.loading}
            error={devicesState.error}
            data={devicesState.data}
            nowMs={devicesState.nowMs}
            onRetry={() => void devicesState.refetch()}
          />

          <NasOverviewCard
            data={nasState.data}
            loading={nasState.loading}
            error={nasState.error}
            nowMs={nasState.nowMs}
            onRetry={() => void nasState.refetch()}
          />

          {groupedDevices.other.length > 0 ? (
            <DeviceGroupCard
              title="其他设备"
              os="linux"
              devices={groupedDevices.other}
              loading={devicesState.loading}
              error={devicesState.error}
              data={devicesState.data}
              nowMs={devicesState.nowMs}
              onRetry={() => void devicesState.refetch()}
            />
          ) : null}
        </CardGrid>
      </div>

      {/* 底部双栏：VPS 最近到期 + 影视下载概况 */}
      <CardGrid columns={2}>
        <VpsNearestSection
          data={vpsState.data}
          loading={vpsState.loading}
          error={vpsState.error}
          onRetry={() => void vpsState.refetch()}
        />

        <SectionCard
          icon={Film}
          title="影视下载概况"
          subtitle="仅统计影视下载（qB）与保种（TR）及 MoviePilot，不含刷流"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/brush"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Flame className="size-3.5 text-amber-500" aria-hidden="true" />
                <span>刷流</span>
              </Link>
              <Link to="/seeding" className="text-xs font-medium text-primary hover:underline">
                下载器
              </Link>
              <Link
                to="/media"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
              >
                <span>影视</span>
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          }
        >
          {mediaInitialLoading ? (
            <LoadingState
              variant="skeleton"
              rows={2}
              columns={2}
              compact
              message="正在加载影视下载概况..."
            />
          ) : mediaUnconfigured ? (
            <EmptyState
              compact
              hideIcon
              title="尚未配置影视或下载器"
              description="请前往设置页配置 MoviePilot 或添加 download / seed 下载器"
              action={
                <Link
                  to="/settings"
                  className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
                >
                  前往设置
                </Link>
              }
            />
          ) : (
            <div className="space-y-4">
              {downloadersState.error && !downloadersState.data ? (
                <ErrorState
                  compact
                  title="获取下载器概况失败"
                  message={downloadersState.error.message}
                  onRetry={() => void downloadersState.refetch()}
                />
              ) : null}

              {mpState.error && !mpState.data ? (
                <ErrorState
                  compact
                  title="获取 MoviePilot 概况失败"
                  message={mpState.error.message}
                  onRetry={() => void mpState.refetch()}
                />
              ) : null}

              {mediaOverview.hasDownloaders || mediaOverview.hasMoviepilot ? (
                <>
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3 [&>*]:min-w-0">
                    <Link
                      to="/media"
                      className="block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <DataCard
                        compact
                        interactive
                        className="h-full"
                        title="正在下载"
                        value={mediaOverview.downloadingCount}
                        icon={Download}
                        iconClassName="text-sky-500"
                        footer={
                          <span className="inline-flex items-center gap-1">
                            <ArrowDown className="size-3 text-sky-500" aria-hidden="true" />
                            <span>下载 {formatSpeed(mediaOverview.downloadSpeed)}</span>
                          </span>
                        }
                      />
                    </Link>

                    <Link
                      to="/seeding"
                      className="block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <DataCard
                        compact
                        interactive
                        className="h-full"
                        title="保种数"
                        value={mediaOverview.seedingCount ?? '—'}
                        icon={HardDrive}
                        iconClassName="text-emerald-500"
                        footer={
                          <span className="inline-flex items-center gap-1">
                            <ArrowUp className="size-3 text-emerald-500" aria-hidden="true" />
                            <span>上传 {formatSpeed(mediaOverview.uploadSpeed)}</span>
                          </span>
                        }
                      />
                    </Link>

                    <Link
                      to="/media"
                      className="block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <DataCard
                        compact
                        interactive
                        className="h-full"
                        title="待整理"
                        value={mediaOverview.pendingTransfer ?? '—'}
                        icon={Layers}
                        iconClassName="text-amber-500"
                        footer={
                          mpState.data?.configured && !mpState.data.online
                            ? 'MoviePilot 离线'
                            : mediaOverview.pendingTransfer === null
                              ? '整理队列暂不可用'
                              : 'MoviePilot 待整理队列'
                        }
                      />
                    </Link>

                    <Link
                      to="/media?tab=subscriptions"
                      className="block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <DataCard
                        compact
                        interactive
                        className="h-full"
                        title="影视订阅"
                        value={mediaOverview.subscribesCount ?? '—'}
                        icon={Film}
                        footer={
                          mpState.data?.configured
                            ? mpState.data.online
                              ? 'MoviePilot 追剧订阅'
                              : (mpState.data.error ?? 'MoviePilot 连接失败')
                            : '未配置 MoviePilot'
                        }
                      />
                    </Link>
                  </div>

                  {mediaOverview.mediaInstances.length > 0 ? (
                    <div className="space-y-2 border-t border-border/60 pt-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        影视下载与保种实例
                      </div>
                      <div className="space-y-1.5">
                        {mediaOverview.mediaInstances.map((inst) => (
                          <Link
                            key={inst.id}
                            to={`/seeding/${encodeURIComponent(inst.id)}`}
                            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs transition-colors hover:border-primary/40"
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <DownloaderTypeBadge type={inst.type} />
                              <span className="truncate font-medium text-foreground">
                                {inst.name}
                              </span>
                              {inst.tags.map((tag) => (
                                <DownloaderTagBadge key={tag} tag={tag} />
                              ))}
                            </div>
                            <div className="flex max-w-full flex-wrap items-center gap-2 text-muted-foreground tabular-nums">
                              {inst.online ? (
                                <span>
                                  ↓ {formatSpeed(inst.dlSpeed)} · ↑ {formatSpeed(inst.upSpeed)}
                                </span>
                              ) : null}
                              <StatusBadge size="sm" status={inst.online ? 'online' : 'offline'} />
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </SectionCard>
      </CardGrid>
    </div>
  );
}

export default OverviewPage;
