import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DevicesStatusResponse,
  DownloadersSummaryResponse,
  MoviepilotSummaryResponse,
  NasStatusResponse,
  VpsListResponse,
} from '@/lib/api';
import { OverviewPage } from '@/pages/OverviewPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const gib = 1024 * 1024 * 1024;
const mib = 1024 * 1024;

function buildHealthyResponses(): {
  devices: DevicesStatusResponse;
  nas: NasStatusResponse;
  vps: VpsListResponse;
  downloaders: DownloadersSummaryResponse;
  moviepilot: MoviepilotSummaryResponse;
} {
  return {
    devices: {
      configured: true,
      source: 'file',
      readonly: false,
      checkedAt: '2026-11-27T08:00:00.000Z',
      summary: { total: 3, online: 3, offline: 0 },
      devices: [
        {
          id: 'win-1',
          name: '客厅 Windows',
          os: 'windows',
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          data: {
            hostname: 'DEMO-WIN',
            os: 'windows',
            osVersion: 'Windows 11 Pro',
            bootTime: '2026-11-26T00:00:00.000Z',
            uptimeSeconds: 36000,
            cpu: { model: 'Demo CPU', cores: 8, loadPercent: 25 },
            memory: { totalBytes: 32 * gib, usedBytes: 16 * gib, usedPercent: 50 },
            disks: [
              {
                mount: 'C:',
                label: '系统盘',
                totalBytes: 500 * gib,
                freeBytes: 200 * gib,
                usedPercent: 60,
              },
            ],
          },
        },
        {
          id: 'mac-1',
          name: '书房 Mac mini',
          os: 'macos',
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          data: {
            hostname: 'DEMO-MAC1',
            os: 'macos',
            osVersion: 'macOS 15.1',
            bootTime: '2026-11-20T00:00:00.000Z',
            uptimeSeconds: 86400,
            cpu: { model: 'Apple M2', cores: 8, loadPercent: 18 },
            memory: { totalBytes: 16 * gib, usedBytes: 8 * gib, usedPercent: 48 },
            disks: [
              {
                mount: '/',
                label: 'Macintosh HD',
                totalBytes: 512 * gib,
                freeBytes: 300 * gib,
                usedPercent: 41,
              },
            ],
          },
        },
        {
          id: 'mac-2',
          name: '客厅 MacBook',
          os: 'macos',
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          data: {
            hostname: 'DEMO-MAC2',
            os: 'macos',
            osVersion: 'macOS 15.1',
            bootTime: '2026-11-25T00:00:00.000Z',
            uptimeSeconds: 7200,
            cpu: { model: 'Apple M3', cores: 8, loadPercent: 12 },
            memory: { totalBytes: 24 * gib, usedBytes: 10 * gib, usedPercent: 42 },
            disks: [
              {
                mount: '/Data',
                label: 'Data',
                totalBytes: 512 * gib,
                freeBytes: 250 * gib,
                usedPercent: 51,
              },
            ],
          },
        },
      ],
    },
    nas: {
      configured: true,
      mock: false,
      online: true,
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: false,
      data: {
        hostname: 'demo-nas',
        osVersion: 'Debian 12',
        uptimeSeconds: 86400,
        bootTime: '2026-11-26T08:00:00.000Z',
        loadAvg: [0.1, 0.2, 0.3],
        cpu: { model: 'Demo NAS CPU', cores: 4, loadPercent: 21 },
        memory: {
          totalBytes: 16 * gib,
          usedBytes: 8 * gib,
          availableBytes: 8 * gib,
          usedPercent: 52,
        },
        temperatures: [],
        maxTemperatureC: 48,
        smart: { available: false, disks: [] },
        raids: [
          {
            name: 'md0',
            status: 'active',
            level: 'raid1',
            members: ['sda1', 'sdb1'],
            stateFlags: '[UU]',
            activeDevices: 2,
            totalDevices: 2,
            healthy: true,
            statusLabel: '正常',
          },
        ],
        volumes: [
          {
            mount: '/volume1',
            device: '/dev/md0',
            fsType: 'btrfs',
            totalBytes: 1000 * gib,
            usedBytes: 640 * gib,
            availableBytes: 360 * gib,
            usedPercent: 64,
            isVolume: true,
          },
        ],
        docker: { available: false, containers: [] },
      },
    },
    vps: {
      configured: true,
      readonly: false,
      timezone: 'Asia/Shanghai',
      summary: { total: 4, expired: 0, within7Days: 0, within30Days: 1, invalid: 0 },
      servers: [
        {
          id: 'v4',
          name: '德州备用机',
          region: '德州',
          ip: '192.0.2.40',
          monthlyTrafficGB: 500,
          role: '备份',
          provider: 'Cloud D',
          expiresAt: '2027-06-01',
          price: 100,
          currency: 'CNY',
          renewUrl: null,
          note: null,
          daysLeft: 186,
          level: 'ok',
        },
        {
          id: 'v2',
          name: '东京节点',
          region: '日本',
          ip: '192.0.2.20',
          monthlyTrafficGB: 2000,
          role: '出口',
          provider: 'Cloud B',
          expiresAt: '2026-12-10',
          price: 5,
          currency: 'USD',
          renewUrl: null,
          note: null,
          daysLeft: 13,
          level: 'warning',
        },
        {
          id: 'v1',
          name: '香港主力',
          region: '香港',
          ip: '192.0.2.10',
          monthlyTrafficGB: 1000,
          role: '主线',
          provider: 'Cloud A',
          expiresAt: '2026-12-06',
          price: 29,
          currency: 'CNY',
          renewUrl: null,
          note: null,
          daysLeft: 9,
          level: 'warning',
        },
        {
          id: 'v3',
          name: '新加坡节点',
          region: '新加坡',
          ip: '192.0.2.30',
          monthlyTrafficGB: 1000,
          role: '中转',
          provider: 'Cloud C',
          expiresAt: '2026-12-22',
          price: 39,
          currency: 'CNY',
          renewUrl: null,
          note: null,
          daysLeft: 25,
          level: 'warning',
        },
      ],
    },
    downloaders: {
      configured: true,
      mock: false,
      checkedAt: '2026-11-27T08:00:00.000Z',
      totals: {
        totalInstances: 3,
        onlineInstances: 3,
        offlineInstances: 0,
        upSpeed: 35 * mib,
        dlSpeed: 26 * mib,
        totalSize: 1500 * gib,
        counts: { seeding: 130, downloading: 11, paused: 0, error: 0, stalled: 0, total: 141 },
      },
      instances: [
        {
          id: 'qb-1',
          name: 'qB1 下载',
          type: 'qbittorrent',
          tags: ['download'],
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          version: 'v5.0.0',
          upSpeed: 2 * mib,
          dlSpeed: 6 * mib,
          counts: { seeding: 5, downloading: 2, paused: 0, error: 0, stalled: 0, total: 7 },
          totalSize: 100 * gib,
          byTracker: [],
          problems: [],
          problemsTotal: 0,
          activeTasks: [],
          activeTotal: 2,
        },
        {
          id: 'tr-1',
          name: 'TR 保种',
          type: 'transmission',
          tags: ['seed'],
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          version: '4.0.6',
          upSpeed: 3 * mib,
          dlSpeed: 0,
          counts: { seeding: 45, downloading: 0, paused: 0, error: 0, stalled: 0, total: 45 },
          totalSize: 600 * gib,
          byTracker: [],
          problems: [],
          problemsTotal: 0,
          activeTasks: [],
          activeTotal: 0,
        },
        {
          id: 'qb-brush',
          name: 'qB 刷流专机',
          type: 'qbittorrent',
          tags: ['brush'],
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          version: 'v5.0.0',
          upSpeed: 30 * mib,
          dlSpeed: 20 * mib,
          counts: { seeding: 80, downloading: 9, paused: 0, error: 0, stalled: 0, total: 89 },
          totalSize: 800 * gib,
          byTracker: [],
          problems: [],
          problemsTotal: 0,
          activeTasks: [],
          activeTotal: 9,
        },
      ],
    },
    moviepilot: {
      configured: true,
      mock: false,
      online: true,
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: false,
      data: {
        subscribes: [
          {
            id: 1,
            name: '剧集 A',
            year: '2026',
            type: '电视剧',
            season: 1,
            state: 'R',
            totalEpisode: 12,
            lackEpisode: 2,
            lastUpdate: '',
          },
          {
            id: 2,
            name: '电影 B',
            year: '2026',
            type: '电影',
            season: null,
            state: 'R',
            totalEpisode: 1,
            lackEpisode: 0,
            lastUpdate: '',
          },
        ],
        transfers: [],
        transferTotal: 0,
        downloads: [],
        activeDownloads: [],
        activeDownloadsTotal: 2,
        transferQueue: { available: true, items: [], total: 3 },
        transferQueueTotal: 3,
        sites: [],
        downloader: null,
      },
    },
  };
}

describe('OverviewPage 首页总览', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('展示 Windows/Mac/NAS 指标、VPS 最近 3 台、影视概况排除 brush 刷流且无异常时显示暂无异常', async () => {
    const sample = buildHealthyResponses();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('/api/devices/status')) return jsonResponse(sample.devices);
      if (url.startsWith('/api/nas/status')) return jsonResponse(sample.nas);
      if (url.startsWith('/api/vps')) return jsonResponse(sample.vps);
      if (url.startsWith('/api/downloaders/summary')) return jsonResponse(sample.downloaders);
      if (url.startsWith('/api/moviepilot/summary')) return jsonResponse(sample.moviepilot);
      return jsonResponse({}, 404);
    });

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    // 异常提示区：全部健康时展示暂无异常
    expect(await screen.findByText('暂无异常')).toBeInTheDocument();
    expect(screen.getByText('运行正常')).toBeInTheDocument();

    // 设备区：Windows 单台指标 + Mac 多台汇总指标 + NAS 指标
    expect(screen.getByText('客厅 Windows')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '客厅 Windows CPU' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(screen.getByRole('progressbar', { name: '客厅 Windows 内存' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(screen.getByRole('progressbar', { name: '客厅 Windows 磁盘 C:' })).toHaveAttribute(
      'aria-valuenow',
      '60',
    );

    expect(screen.getByText('2/2 在线')).toBeInTheDocument();
    expect(screen.getByText('书房 Mac mini')).toBeInTheDocument();
    expect(screen.getByText('客厅 MacBook')).toBeInTheDocument();
    expect(screen.getByText('CPU 18%')).toBeInTheDocument();
    expect(screen.getByText('CPU 12%')).toBeInTheDocument();

    expect(screen.getByText('demo-nas')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'NAS CPU' })).toHaveAttribute(
      'aria-valuenow',
      '21',
    );
    expect(screen.getByRole('progressbar', { name: 'NAS 内存' })).toHaveAttribute(
      'aria-valuenow',
      '52',
    );
    expect(screen.getByRole('progressbar', { name: 'NAS 磁盘 /volume1' })).toHaveAttribute(
      'aria-valuenow',
      '64',
    );
    expect(screen.getByText('最高温度 48℃')).toBeInTheDocument();

    // 跳转到 /devices 和 /nas
    const deviceLinks = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('href') === '/devices');
    expect(deviceLinks.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: /demo-nas/ })).toHaveAttribute('href', '/nas');

    // VPS 最近到期：按到期日升序取前 3 台（9天、13天、25天），不包含第 4 台（186天）
    expect(screen.getByText('香港主力')).toBeInTheDocument();
    expect(screen.getByText('日本 · 东京节点')).toBeInTheDocument();
    expect(screen.getByText('新加坡节点')).toBeInTheDocument();
    expect(screen.queryByText('德州备用机')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看全部' })).toHaveAttribute('href', '/vps');

    // 影视下载概况：不含 brush 刷流实例的 9 个下载 / 80 个保种 / 20 MiB/s 下载 / 30 MiB/s 上传
    expect(screen.queryByText('qB 刷流专机')).not.toBeInTheDocument();
    expect(screen.getByText('qB1 下载')).toBeInTheDocument();
    expect(screen.getByText('TR 保种')).toBeInTheDocument();

    // 正在下载 = 2（仅 qb-1），保种 = 45（仅 tr-1），待整理 = 3，订阅 = 2
    const downloadingCard = screen.getByRole('link', { name: /正在下载/ });
    expect(downloadingCard).toHaveAttribute('href', '/media');
    expect(within(downloadingCard).getByText('2')).toBeInTheDocument();
    expect(within(downloadingCard).getByText('下载 6.0 MiB/s')).toBeInTheDocument();

    const seedingCard = screen.getByRole('link', { name: /保种数/ });
    expect(seedingCard).toHaveAttribute('href', '/seeding');
    expect(within(seedingCard).getByText('45')).toBeInTheDocument();
    expect(within(seedingCard).getByText('上传 5.0 MiB/s')).toBeInTheDocument();

    // 刷流小入口 + 影视链接
    expect(screen.getByRole('link', { name: '刷流' })).toHaveAttribute('href', '/brush');
    expect(screen.getByRole('link', { name: '影视' })).toHaveAttribute('href', '/media');
  });

  it('异常提示区汇总四类规则（设备离线、VPS <= 7天含已过期/今日到期、磁盘 >= 90%、下载器异常）并可跳转', async () => {
    const sample = buildHealthyResponses();
    const { data: _omit, ...restDevice } = sample.devices.devices[0]!;
    void _omit;
    sample.devices.devices[0] = {
      ...restDevice,
      online: false,
      error: 'SSH 连接超时',
    };
    sample.devices.devices[1]!.data!.disks[0]!.usedPercent = 93;
    sample.nas.data!.volumes[0]!.usedPercent = 91;
    sample.vps.servers = [
      {
        id: 'v-exp',
        name: '已过期主机',
        region: '香港',
        ip: '192.0.2.11',
        monthlyTrafficGB: null,
        role: null,
        provider: null,
        expiresAt: '2026-11-25',
        price: null,
        currency: null,
        renewUrl: null,
        note: null,
        daysLeft: -2,
        level: 'expired',
      },
      {
        id: 'v-today',
        name: '今日到期主机',
        region: '日本',
        ip: '192.0.2.12',
        monthlyTrafficGB: null,
        role: null,
        provider: null,
        expiresAt: '2026-11-27',
        price: null,
        currency: null,
        renewUrl: null,
        note: null,
        daysLeft: 0,
        level: 'danger',
      },
      {
        id: 'v-ok',
        name: '充裕主机',
        region: '美国',
        ip: '192.0.2.13',
        monthlyTrafficGB: null,
        role: null,
        provider: null,
        expiresAt: '2027-01-01',
        price: null,
        currency: null,
        renewUrl: null,
        note: null,
        daysLeft: 35,
        level: 'ok',
      },
    ];
    sample.downloaders.instances[0] = {
      ...sample.downloaders.instances[0]!,
      online: false,
      error: '认证失败',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('/api/devices/status')) return jsonResponse(sample.devices);
      if (url.startsWith('/api/nas/status')) return jsonResponse(sample.nas);
      if (url.startsWith('/api/vps')) return jsonResponse(sample.vps);
      if (url.startsWith('/api/downloaders/summary')) return jsonResponse(sample.downloaders);
      if (url.startsWith('/api/moviepilot/summary')) return jsonResponse(sample.moviepilot);
      return jsonResponse({}, 404);
    });

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('6 项异常')).toBeInTheDocument();

    // 1. 设备离线 -> /devices
    const offlineLink = screen.getByRole('link', { name: /设备离线.*客厅 Windows/ });
    expect(offlineLink).toHaveAttribute('href', '/devices');

    // 2. VPS <= 7 天 -> /vps（不含 35 天的充裕主机）
    expect(screen.getByRole('link', { name: /即将到期.*香港 · 已过期主机/ })).toHaveAttribute(
      'href',
      '/vps',
    );
    expect(screen.getByRole('link', { name: /即将到期.*日本 · 今日到期主机/ })).toHaveAttribute(
      'href',
      '/vps',
    );
    expect(screen.queryByRole('link', { name: /即将到期.*充裕主机/ })).not.toBeInTheDocument();

    // 3. 磁盘 >= 90%（家用设备与 NAS 均检查）
    expect(screen.getByRole('link', { name: /磁盘告警.*书房 Mac mini/ })).toHaveAttribute(
      'href',
      '/devices',
    );
    expect(screen.getByRole('link', { name: /磁盘告警.*NAS · \/volume1/ })).toHaveAttribute(
      'href',
      '/nas',
    );

    // 4. 下载器连不上 -> /seeding/qb-1
    expect(screen.getByRole('link', { name: /下载器异常.*qB1 下载/ })).toHaveAttribute(
      'href',
      '/seeding/qb-1',
    );
  });

  it('单块接口失败时局部展示 ErrorState 且下载器接口失败计入异常，支持刷新与移动端单列布局', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });

    const sample = buildHealthyResponses();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('/api/devices/status')) return jsonResponse(sample.devices);
      if (url.startsWith('/api/nas/status')) return jsonResponse({ error: 'NAS SSH 超时' }, 502);
      if (url.startsWith('/api/vps')) return jsonResponse(sample.vps);
      if (url.startsWith('/api/downloaders/summary'))
        return jsonResponse({ error: '下载器服务不可用' }, 500);
      if (url.startsWith('/api/moviepilot/summary')) return jsonResponse(sample.moviepilot);
      return jsonResponse({}, 404);
    });

    const { container } = render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    // 局部报错不阻断其他区块
    expect(await screen.findByText('获取 NAS 状态失败')).toBeInTheDocument();
    expect(screen.getByText('获取下载器概况失败')).toBeInTheDocument();
    expect(screen.getByText('客厅 Windows')).toBeInTheDocument();
    expect(screen.getByText('香港主力')).toBeInTheDocument();

    // 异常区包含 NAS 获取失败与下载器状态获取失败
    expect(screen.getByRole('link', { name: /下载器状态获取失败/ })).toHaveAttribute(
      'href',
      '/seeding',
    );

    // 移动端单列布局（grid-cols-1）存在且无报错
    expect(container.querySelector('.grid-cols-1')).toBeInTheDocument();

    // 点击刷新触发重新采集
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(fetchSpy).toHaveBeenCalledWith('/api/devices/status?refresh=1', expect.anything());
    expect(fetchSpy).toHaveBeenCalledWith('/api/nas/status?refresh=1', expect.anything());
    expect(fetchSpy).toHaveBeenCalledWith('/api/downloaders/summary?refresh=1', expect.anything());
  });
});
