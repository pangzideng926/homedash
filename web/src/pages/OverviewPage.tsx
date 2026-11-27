import { useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowUpDown, Bell, HardDrive, Monitor, Server, type LucideIcon } from 'lucide-react';
import { DataCard, PageHeader, StatusBadge, type StatusVariant } from '@/components/common';
import { DeviceOsIcon } from '@/components/devices/DeviceOsIcon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import {
  fetchDevicesStatus,
  fetchVpsList,
  type DevicesStatusResponse,
  type VpsLevel,
  type VpsListResponse,
  type VpsServerView,
} from '@/lib/api';

interface OverviewPlaceholderItem {
  title: string;
  description: string;
  icon: LucideIcon;
}

const NAS_CARD: OverviewPlaceholderItem = {
  title: 'NAS 状态',
  description: '存储池与系统运行状态',
  icon: HardDrive,
};

const SEEDING_CARD: OverviewPlaceholderItem = {
  title: '做种概况',
  description: '刷流与做种实时数据',
  icon: ArrowUpDown,
};

const ALERTS_CARD: OverviewPlaceholderItem = {
  title: '最近告警',
  description: '账号登录与安全异常记录',
  icon: Bell,
};

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

export function OverviewPage() {
  const devicesFetcher = useCallback((signal: AbortSignal) => fetchDevicesStatus({ signal }), []);
  const vpsFetcher = useCallback((signal: AbortSignal) => fetchVpsList(signal), []);

  const devicesState = useApi(devicesFetcher);
  const vpsState = useApi(vpsFetcher);

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
        description="集中查看家庭 NAS、做种服务、家用设备、VPS 到期与安全告警。"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DataCard
          title={NAS_CARD.title}
          description={NAS_CARD.description}
          icon={NAS_CARD.icon}
          value="暂无数据"
          status="unknown"
          statusLabel="待接入"
        />
        <DataCard
          title={SEEDING_CARD.title}
          description={SEEDING_CARD.description}
          icon={SEEDING_CARD.icon}
          value="暂无数据"
          status="unknown"
          statusLabel="待接入"
        />
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
        <DataCard
          title={ALERTS_CARD.title}
          description={ALERTS_CARD.description}
          icon={ALERTS_CARD.icon}
          value="暂无数据"
          status="unknown"
          statusLabel="待接入"
        />
      </div>
    </div>
  );
}

export default OverviewPage;
