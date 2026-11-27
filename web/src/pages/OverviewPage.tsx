import { useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowUpDown, Bell, Film, HardDrive, Monitor, Server } from 'lucide-react';
import { DataCard, PageHeader, StatusBadge, type StatusVariant } from '@/components/common';
import { DeviceOsIcon } from '@/components/devices/DeviceOsIcon';
import { formatSpeed } from '@/components/devices/device-utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import {
  fetchDevicesStatus,
  fetchDownloadersSummary,
  fetchMoviepilotSummary,
  fetchNasStatus,
  fetchVpsList,
  type DevicesStatusResponse,
  type DownloadersSummaryResponse,
  type MoviepilotSummaryResponse,
  type NasStatusResponse,
  type VpsLevel,
  type VpsListResponse,
  type VpsServerView,
} from '@/lib/api';

function vpsLevelToStatus(level: VpsLevel | null): StatusVariant {
  if (level === 'expired' || level === 'danger') return 'error';
  if (level === 'warning') return 'warning';
  if (level === 'ok') return 'success';
  return 'unknown';
}

function formatDaysLeftLabel(server: VpsServerView): string {
  if (server.daysLeft === null) return '日期无效';
  if (server.daysLeft < 0) return `已过期 ${Math.abs(server.daysLeft)} 天`;
  if (server.daysLeft === 0) return '今天到期';
  return `剩余 ${server.daysLeft} 天`;
}

function getNearestVpsServer(servers: readonly VpsServerView[]): VpsServerView | null {
  const valid = servers.filter((s) => s.daysLeft !== null && s.level !== null);
  if (valid.length === 0) return null;
  return valid.reduce((nearest, current) =>
    (current.daysLeft ?? Infinity) < (nearest.daysLeft ?? Infinity) ? current : nearest,
  );
}

function buildDevicesSummaryBadge(
  data: DevicesStatusResponse | null,
  loading: boolean,
  error: Error | null,
): {
  headline: string;
  status: StatusVariant;
  statusLabel: string;
  message?: string;
} {
  if (loading && !data) {
    return {
      headline: '加载中...',
      status: 'unknown',
      statusLabel: '采集中',
      message: '正在采集家用设备状态',
    };
  }
  if (error && !data) {
    return {
      headline: '状态异常',
      status: 'error',
      statusLabel: '请求失败',
      message: error.message,
    };
  }
  if (!data || !data.configured || data.errorCode === 'UNCONFIGURED') {
    return {
      headline: '未配置',
      status: 'unconfigured',
      statusLabel: '未配置',
      message: '点击进入家用设备管理页',
    };
  }
  if (data.error) {
    return {
      headline: '文件异常',
      status: 'error',
      statusLabel: '异常',
      message: data.error,
    };
  }
  if (data.summary.total === 0) {
    return {
      headline: '0 / 0',
      status: 'unknown',
      statusLabel: '无启用设备',
      message: '点击添加或启用设备',
    };
  }

  const allOnline = data.summary.online === data.summary.total;
  const noneOnline = data.summary.online === 0;
  return {
    headline: `${data.summary.online} / ${data.summary.total} 在线`,
    status: allOnline ? 'success' : noneOnline ? 'error' : 'warning',
    statusLabel: allOnline ? '全部在线' : noneOnline ? '全部离线' : '部分离线',
  };
}

function buildVpsCardProps(
  data: VpsListResponse | null,
  loading: boolean,
  error: Error | null,
): {
  value: string;
  status: StatusVariant;
  statusLabel: string;
  footer: string;
} {
  if (loading && !data) {
    return {
      value: '加载中...',
      status: 'unknown',
      statusLabel: '加载中',
      footer: '正在读取 VPS 到期清单',
    };
  }
  if (error && !data) {
    return {
      value: '读取失败',
      status: 'error',
      statusLabel: '请求失败',
      footer: error.message,
    };
  }
  if (!data || !data.configured || data.errorCode === 'UNCONFIGURED') {
    return {
      value: '未配置',
      status: 'unconfigured',
      statusLabel: '未配置',
      footer: '点击进入 VPS 管理页',
    };
  }
  if (data.error) {
    return {
      value: '文件异常',
      status: 'error',
      statusLabel: '异常',
      footer: data.error,
    };
  }
  if (data.summary.total === 0) {
    return {
      value: '0 台',
      status: 'unknown',
      statusLabel: '暂无记录',
      footer: '点击添加第一台 VPS',
    };
  }

  const nearest = getNearestVpsServer(data.servers);
  if (!nearest) {
    return {
      value: `${data.summary.total} 台`,
      status: 'error',
      statusLabel: '日期异常',
      footer: '存在日期格式错误的条目，点击查看',
    };
  }

  const statusLabel = formatDaysLeftLabel(nearest);
  return {
    value: `${data.summary.total} 台`,
    status: vpsLevelToStatus(nearest.level),
    statusLabel,
    footer: `最近到期：${nearest.name}（${statusLabel}）`,
  };
}

function buildNasCardView(
  data: NasStatusResponse | null,
  loading: boolean,
  error: Error | null,
): {
  to: string;
  value: string;
  status: StatusVariant;
  statusLabel: string;
  lines: string[];
  footer?: string;
} {
  if (loading && !data) {
    return {
      to: '/nas',
      value: '加载中...',
      status: 'unknown',
      statusLabel: '采集中',
      lines: [],
      footer: '正在采集 NAS 状态',
    };
  }
  if (error && !data) {
    return {
      to: '/nas',
      value: '读取失败',
      status: 'error',
      statusLabel: '请求失败',
      lines: [],
      footer: error.message,
    };
  }
  if (!data || !data.configured) {
    return {
      to: '/settings',
      value: '未配置',
      status: 'unconfigured',
      statusLabel: '未配置',
      lines: [],
      footer: '未配置，去设置',
    };
  }
  if (!data.online || !data.data) {
    return {
      to: '/nas',
      value: '离线',
      status: 'error',
      statusLabel: '离线',
      lines: [],
      footer: data.error ?? 'NAS 连接失败',
    };
  }

  const d = data.data;
  const topVolume =
    d.volumes.length > 0
      ? d.volumes.reduce((best, cur) => (cur.usedPercent > best.usedPercent ? cur : best))
      : null;

  const lines = [
    `CPU ${d.cpu.loadPercent}% · 内存 ${d.memory.usedPercent}%`,
    d.maxTemperatureC !== null ? `最高温度 ${d.maxTemperatureC}℃` : '温度传感器不可用',
    topVolume ? `最高卷 ${topVolume.mount}（${topVolume.usedPercent}%）` : '暂无挂载卷数据',
  ];

  return {
    to: '/nas',
    value: d.hostname,
    status: 'success',
    statusLabel: '在线',
    lines,
  };
}

function buildDownloadersCardView(
  data: DownloadersSummaryResponse | null,
  loading: boolean,
  error: Error | null,
): {
  to: string;
  value: string;
  status: StatusVariant;
  statusLabel: string;
  lines: string[];
  footer?: string;
} {
  if (loading && !data) {
    return {
      to: '/seeding',
      value: '加载中...',
      status: 'unknown',
      statusLabel: '采集中',
      lines: [],
      footer: '正在读取下载器状态',
    };
  }
  if (error && !data) {
    return {
      to: '/seeding',
      value: '读取失败',
      status: 'error',
      statusLabel: '请求失败',
      lines: [],
      footer: error.message,
    };
  }
  if (!data || !data.configured) {
    return {
      to: '/settings',
      value: '未配置',
      status: 'unconfigured',
      statusLabel: '未配置',
      lines: [],
      footer: '未配置，去设置',
    };
  }
  if (data.totals.totalInstances === 0) {
    return {
      to: '/settings',
      value: '0 实例',
      status: 'unknown',
      statusLabel: '未启用',
      lines: [],
      footer: '请前往设置页启用下载器实例',
    };
  }

  const { totals } = data;
  const issueCount = totals.counts.error + totals.counts.stalled;
  const allOnline = totals.onlineInstances === totals.totalInstances;
  const noneOnline = totals.onlineInstances === 0;

  let status: StatusVariant = 'success';
  let statusLabel = '正常';
  if (noneOnline) {
    status = 'error';
    statusLabel = '全部离线';
  } else if (!allOnline) {
    status = 'warning';
    statusLabel = '部分离线';
  } else if (issueCount > 0) {
    status = 'warning';
    statusLabel = `异常 ${issueCount}`;
  }

  return {
    to: '/seeding',
    value: noneOnline ? '连接失败' : `${totals.counts.seeding} 做种`,
    status,
    statusLabel,
    lines: [
      `上行 ${formatSpeed(totals.upSpeed)} · 下行 ${formatSpeed(totals.dlSpeed)}`,
      `做种 ${totals.counts.seeding} · 出错/卡住 ${issueCount}`,
      `在线实例 ${totals.onlineInstances} / ${totals.totalInstances}`,
    ],
  };
}

function buildMoviepilotCardView(
  data: MoviepilotSummaryResponse | null,
  loading: boolean,
  error: Error | null,
): {
  to: string;
  value: string;
  status: StatusVariant;
  statusLabel: string;
  summaryLine?: string;
  recentTransfers: Array<{ title: string; status: boolean }>;
  footer?: string;
} {
  if (loading && !data) {
    return {
      to: '/media',
      value: '加载中...',
      status: 'unknown',
      statusLabel: '采集中',
      recentTransfers: [],
      footer: '正在读取影视数据',
    };
  }
  if (error && !data) {
    return {
      to: '/media',
      value: '读取失败',
      status: 'error',
      statusLabel: '请求失败',
      recentTransfers: [],
      footer: error.message,
    };
  }
  if (!data || !data.configured) {
    return {
      to: '/settings',
      value: '未配置',
      status: 'unconfigured',
      statusLabel: '未配置',
      recentTransfers: [],
      footer: '未配置，去设置',
    };
  }
  if (!data.online || !data.data) {
    return {
      to: '/media',
      value: '连接失败',
      status: 'error',
      statusLabel: '异常',
      recentTransfers: [],
      footer: data.error ?? '无法连接 MoviePilot',
    };
  }

  const d = data.data;
  return {
    to: '/media',
    value: `${d.subscribes.length} 订阅`,
    status: 'success',
    statusLabel: '在线',
    summaryLine: `订阅 ${d.subscribes.length} · 正在下载 ${d.downloads.length}`,
    recentTransfers: d.transfers.slice(0, 3).map((t) => ({ title: t.title, status: t.status })),
  };
}

export function OverviewPage() {
  const nasFetcher = useCallback((signal: AbortSignal) => fetchNasStatus({ signal }), []);
  const downloadersFetcher = useCallback(
    (signal: AbortSignal) => fetchDownloadersSummary({ signal }),
    [],
  );
  const mpFetcher = useCallback((signal: AbortSignal) => fetchMoviepilotSummary({ signal }), []);
  const devicesFetcher = useCallback((signal: AbortSignal) => fetchDevicesStatus({ signal }), []);
  const vpsFetcher = useCallback((signal: AbortSignal) => fetchVpsList(signal), []);

  const nasState = useApi(nasFetcher);
  const downloadersState = useApi(downloadersFetcher);
  const mpState = useApi(mpFetcher);
  const devicesState = useApi(devicesFetcher);
  const vpsState = useApi(vpsFetcher);

  const nasCard = buildNasCardView(nasState.data, nasState.loading, nasState.error);
  const downloadersCard = buildDownloadersCardView(
    downloadersState.data,
    downloadersState.loading,
    downloadersState.error,
  );
  const mpCard = buildMoviepilotCardView(mpState.data, mpState.loading, mpState.error);
  const devicesSummary = buildDevicesSummaryBadge(
    devicesState.data,
    devicesState.loading,
    devicesState.error,
  );
  const vpsCard = buildVpsCardProps(vpsState.data, vpsState.loading, vpsState.error);

  return (
    <div className="space-y-6">
      <PageHeader
        title="总览"
        description="集中查看家庭 NAS、下载做种、影视订阅、家用设备、VPS 到期与安全告警。"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* NAS 汇总卡 */}
        <Link
          to={nasCard.to}
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="flex h-full flex-col justify-between transition-colors hover:border-primary/40">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">NAS 状态</CardTitle>
                <CardDescription>存储卷、温度与系统运行状态</CardDescription>
              </div>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <HardDrive className="size-4" aria-hidden="true" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-2xl font-semibold tracking-tight text-foreground">
                  {nasCard.value}
                </div>
                <StatusBadge status={nasCard.status} label={nasCard.statusLabel} />
              </div>
              {nasCard.lines.length > 0 ? (
                <ul className="space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                  {nasCard.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : nasCard.footer ? (
                <p className="text-xs text-muted-foreground">{nasCard.footer}</p>
              ) : null}
            </CardContent>
          </Card>
        </Link>

        {/* 下载汇总卡 */}
        <Link
          to={downloadersCard.to}
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="flex h-full flex-col justify-between transition-colors hover:border-primary/40">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">下载与做种</CardTitle>
                <CardDescription>多实例下载器实时传输与做种汇总</CardDescription>
              </div>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <ArrowUpDown className="size-4" aria-hidden="true" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-2xl font-semibold tracking-tight text-foreground">
                  {downloadersCard.value}
                </div>
                <StatusBadge status={downloadersCard.status} label={downloadersCard.statusLabel} />
              </div>
              {downloadersCard.lines.length > 0 ? (
                <ul className="space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                  {downloadersCard.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : downloadersCard.footer ? (
                <p className="text-xs text-muted-foreground">{downloadersCard.footer}</p>
              ) : null}
            </CardContent>
          </Card>
        </Link>

        {/* 影视汇总卡 */}
        <Link
          to={mpCard.to}
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="flex h-full flex-col justify-between transition-colors hover:border-primary/40">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">影视订阅</CardTitle>
                <CardDescription>MoviePilot 订阅、下载与最近入库</CardDescription>
              </div>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Film className="size-4" aria-hidden="true" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-2xl font-semibold tracking-tight text-foreground">
                  {mpCard.value}
                </div>
                <StatusBadge status={mpCard.status} label={mpCard.statusLabel} />
              </div>
              {mpCard.summaryLine ? (
                <div className="space-y-1.5 border-t border-border/60 pt-2 text-xs">
                  <div className="text-muted-foreground">{mpCard.summaryLine}</div>
                  {mpCard.recentTransfers.length > 0 ? (
                    <ul className="space-y-1">
                      {mpCard.recentTransfers.map((item, idx) => (
                        <li
                          key={`${item.title}-${idx}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate text-foreground">{item.title}</span>
                          <StatusBadge
                            status={item.status ? 'success' : 'error'}
                            label={item.status ? '成功' : '失败'}
                            showDot={false}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">暂无最近入库记录</p>
                  )}
                </div>
              ) : mpCard.footer ? (
                <p className="text-xs text-muted-foreground">{mpCard.footer}</p>
              ) : null}
            </CardContent>
          </Card>
        </Link>

        {/* 家用设备卡 */}
        <Link
          to="/devices"
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="flex h-full flex-col justify-between transition-colors hover:border-primary/40">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">家用设备</CardTitle>
                <CardDescription>多设备在线状态与硬件负载</CardDescription>
              </div>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Monitor className="size-4" aria-hidden="true" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-2xl font-semibold tracking-tight text-foreground">
                  {devicesSummary.headline}
                </div>
                <StatusBadge status={devicesSummary.status} label={devicesSummary.statusLabel} />
              </div>

              {devicesSummary.message ? (
                <p className="text-xs text-muted-foreground">{devicesSummary.message}</p>
              ) : devicesState.data && devicesState.data.devices.length > 0 ? (
                <ul className="space-y-1.5 border-t border-border/60 pt-2">
                  {devicesState.data.devices.map((device) => (
                    <li key={device.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <DeviceOsIcon os={device.os} className="size-3.5 shrink-0" />
                        <span className="truncate font-medium text-foreground">{device.name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                        <StatusBadge
                          status={device.online ? 'success' : 'error'}
                          label={device.online ? '在线' : '离线'}
                        />
                        {device.online && device.data ? (
                          <span>
                            CPU {device.data.cpu.loadPercent}% · 内存{' '}
                            {device.data.memory.usedPercent}%
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </Link>

        {/* VPS 到期卡 */}
        <Link
          to="/vps"
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DataCard
            title="VPS 到期"
            description="云服务器续费与到期提醒"
            icon={Server}
            value={vpsCard.value}
            status={vpsCard.status}
            statusLabel={vpsCard.statusLabel}
            footer={vpsCard.footer}
            className="h-full transition-colors hover:border-primary/40"
          />
        </Link>

        {/* 最近告警卡 */}
        <DataCard
          title="最近告警"
          description="账号登录与安全异常记录"
          icon={Bell}
          value="暂无数据"
          status="unknown"
          statusLabel="待接入"
        />
      </div>
    </div>
  );
}

export default OverviewPage;
