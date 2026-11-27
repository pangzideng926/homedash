import { ArrowUpDown, Bell, HardDrive, Monitor, Server, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
      <div>
        <h2 className="text-base font-medium text-foreground">运行状态总览</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          集中查看家庭 NAS、做种服务、家用主机、VPS 到期与安全告警。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OVERVIEW_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">{card.title}</CardTitle>
                  <CardDescription>{card.description}</CardDescription>
                </div>
                <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
                  暂无数据
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
