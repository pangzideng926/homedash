import { lazy } from 'react';
import {
  ArrowUpDown,
  Bell,
  Film,
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
const DownloaderDetailPage = lazy(() => import('@/pages/DownloaderDetailPage'));
const MediaPage = lazy(() => import('@/pages/MediaPage'));
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
        title: '下载与做种',
        description: '多实例下载器（qBittorrent / Transmission）只读传输与做种监控',
        icon: ArrowUpDown,
        component: SeedingPage,
        children: [
          {
            id: 'seeding-detail',
            path: '/seeding/:id',
            title: '下载器详情',
            description: '下载器实例状态分组、Tracker/分类/标签统计与异常种子排查',
            hiddenInMenu: true,
            component: DownloaderDetailPage,
          },
        ],
      },
      {
        id: 'media',
        path: '/media',
        title: '影视',
        description: 'MoviePilot 订阅、入库记录、下载任务与站点状态',
        icon: Film,
        component: MediaPage,
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
