import { lazy } from 'react';
import {
  ArrowUpDown,
  Bell,
  HardDrive,
  LayoutDashboard,
  Monitor,
  Server,
  Settings,
} from 'lucide-react';
import type { NavRouteItem } from '@/shell';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const OverviewPage = lazy(() => import('@/pages/OverviewPage'));
const NasPage = lazy(() => import('@/pages/NasPage'));
const SeedingPage = lazy(() => import('@/pages/SeedingPage'));
const DevicesPage = lazy(() => import('@/pages/DevicesPage'));
const PcPage = lazy(() => import('@/pages/PcPage'));
const VpsPage = lazy(() => import('@/pages/VpsPage'));
const AlertsPage = lazy(() => import('@/pages/AlertsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

export const NAV_ROUTES: NavRouteItem[] = [
  {
    id: 'login',
    path: '/login',
    title: '登录',
    requiresAuth: false,
    hiddenInMenu: true,
    component: LoginPage,
  },
  {
    id: 'overview',
    path: '/',
    title: '总览',
    description: '家庭服务器整体运行概况',
    icon: LayoutDashboard,
    component: OverviewPage,
  },
  {
    id: 'monitoring',
    title: '监控中心',
    children: [
      {
        id: 'nas',
        path: '/nas',
        title: 'NAS',
        description: 'NAS 状态与磁盘用量监控',
        icon: HardDrive,
        component: NasPage,
      },
      {
        id: 'seeding',
        path: '/seeding',
        title: '刷流做种',
        description: 'qBittorrent / MoviePilot 刷流与做种数据',
        icon: ArrowUpDown,
        component: SeedingPage,
      },
      {
        id: 'devices',
        path: '/devices',
        title: '家用设备',
        description: '家用 Windows / macOS / Linux 主机状态与资源监控',
        icon: Monitor,
        component: DevicesPage,
      },
      {
        id: 'pc-redirect',
        path: '/pc',
        title: '家用设备',
        hiddenInMenu: true,
        component: PcPage,
      },
      {
        id: 'vps',
        path: '/vps',
        title: 'VPS',
        description: '云服务器状态与到期提醒管理',
        icon: Server,
        component: VpsPage,
      },
      {
        id: 'alerts',
        path: '/alerts',
        title: '告警',
        description: '账号登录与安全异常告警汇总',
        icon: Bell,
        component: AlertsPage,
      },
    ],
  },
  {
    id: 'system',
    title: '系统管理',
    children: [
      {
        id: 'settings',
        path: '/settings',
        title: '设置',
        description: '环境变量与模块配置状态',
        icon: Settings,
        component: SettingsPage,
      },
    ],
  },
];
