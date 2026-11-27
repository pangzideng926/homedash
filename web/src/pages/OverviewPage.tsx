import { useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowUpDown, Bell, HardDrive, Monitor, Server, type LucideIcon } from 'lucide-react';
import { DataCard, PageHeader, type StatusVariant } from '@/components/common';
import { useApi } from '@/hooks/useApi';
import {
  fetchVpsList,
  fetchWindowsStatus,
  type VpsLevel,
  type VpsListResponse,
  type VpsServerView,
  type WindowsStatusResponse,
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

function buildPcCardProps(
  data: WindowsStatusResponse | null,
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
      statusLabel: '采集中',
      footer: '正在检查家用电脑状态',
    };
  }
  if (error && !data) {
    return {
      value: '状态异常',
      status: 'error',
      statusLabel: '请求失败',
      footer: error.message,
    };
  }
  if (!data) {
    return {
      value: '暂无数据',
      status: 'unknown',
      statusLabel: '未配置',
      footer: '点击查看家用电脑详情',
    };
  }
  if (data.errorCode === 'UNCONFIGURED') {
    return {
      value: '未配置',
      status: 'unconfigured',
      statusLabel: '未配置',
      footer: '点击查看配置说明',
    };
  }
  if (!data.online || !data.data) {
    return {
      value: '离线',
      status: 'error',
      statusLabel: '离线',
      footer: data.error ?? '主机离线或采集失败',
    };
  }

  return {
    value: `CPU ${data.data.cpu.loadPercent}%`,
    status: 'success',
    statusLabel: '在线',
    footer: `${data.data.hostname} · 内存 ${data.data.memory.usedPercent}%`,
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
  const pcFetcher = useCallback((signal: AbortSignal) => fetchWindowsStatus({ signal }), []);
  const vpsFetcher = useCallback((signal: AbortSignal) => fetchVpsList(signal), []);

  const pcState = useApi(pcFetcher);
  const vpsState = useApi(vpsFetcher);

  const pcCard = buildPcCardProps(pcState.data, pcState.loading, pcState.error);
  const vpsCard = buildVpsCardProps(vpsState.data, vpsState.loading, vpsState.error);

  return (
    <div className="space-y-6">
      <PageHeader
        title="总览"
        description="集中查看家庭 NAS、做种服务、家用主机、VPS 到期与安全告警。"
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
          to="/pc"
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DataCard
            title="家用电脑"
            description="主机在线状态与硬件负载"
            icon={Monitor}
            value={pcCard.value}
            status={pcCard.status}
            statusLabel={pcCard.statusLabel}
            footer={pcCard.footer}
            className="h-full transition-colors hover:border-primary/40"
          />
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
