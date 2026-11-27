import {
  ArrowUpDown,
  Bell,
  HardDrive,
  LayoutDashboard,
  Monitor,
  Server,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: '总览',
    description: '家庭服务器整体运行概况',
    icon: LayoutDashboard,
  },
  {
    path: '/nas',
    label: 'NAS',
    description: 'NAS 状态与磁盘用量监控',
    icon: HardDrive,
  },
  {
    path: '/seeding',
    label: '刷流做种',
    description: 'qBittorrent / MoviePilot 刷流与做种数据',
    icon: ArrowUpDown,
  },
  {
    path: '/pc',
    label: '家用电脑',
    description: '家用 Windows 主机状态与资源监控',
    icon: Monitor,
  },
  {
    path: '/vps',
    label: 'VPS',
    description: '云服务器状态与到期提醒管理',
    icon: Server,
  },
  {
    path: '/alerts',
    label: '告警',
    description: '账号登录与安全异常告警汇总',
    icon: Bell,
  },
];
