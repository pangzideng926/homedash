import { ArrowUpDown, Bell, HardDrive, Monitor, Server, type LucideIcon } from 'lucide-react';
import { DataCard, PageHeader } from '@/components/common';

interface OverviewCardItem {
  title: string;
  description: string;
  icon: LucideIcon;
}

const OVERVIEW_CARDS: OverviewCardItem[] = [
  {
    title: 'NAS 状态',
    description: '存储池与系统运行状态',
    icon: HardDrive,
  },
  {
    title: '做种概况',
    description: '刷流与做种实时数据',
    icon: ArrowUpDown,
  },
  {
    title: '家用电脑',
    description: '主机在线状态与硬件负载',
    icon: Monitor,
  },
  {
    title: 'VPS 到期',
    description: '云服务器续费与到期提醒',
    icon: Server,
  },
  {
    title: '最近告警',
    description: '账号登录与安全异常记录',
    icon: Bell,
  },
];

export function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="总览"
        description="集中查看家庭 NAS、做种服务、家用主机、VPS 到期与安全告警。"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OVERVIEW_CARDS.map((card) => (
          <DataCard
            key={card.title}
            title={card.title}
            description={card.description}
            icon={card.icon}
            value="暂无数据"
            status="unknown"
            statusLabel="待接入"
          />
        ))}
      </div>
    </div>
  );
}

export default OverviewPage;
