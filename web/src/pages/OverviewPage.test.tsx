import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '@/pages/OverviewPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OverviewPage 总览三张汇总卡', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('正确渲染 NAS、下载、影视三张汇总卡数据，并在未配置时提示去设置', async () => {
    const gib = 1024 * 1024 * 1024;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('/api/nas/status')) {
        return jsonResponse({
          configured: true,
          mock: false,
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          data: {
            hostname: 'demo-nas',
            osVersion: 'Debian 12',
            uptimeSeconds: 1000,
            bootTime: '2026-11-27T07:00:00.000Z',
            loadAvg: [0.1, 0.2, 0.3],
            cpu: { model: 'Demo', cores: 4, loadPercent: 21.5 },
            memory: {
              totalBytes: 16 * gib,
              usedBytes: 8 * gib,
              availableBytes: 8 * gib,
              usedPercent: 50,
            },
            temperatures: [],
            maxTemperatureC: 52,
            smart: { available: false, disks: [] },
            raids: [],
            volumes: [
              {
                mount: '/volume1',
                device: '/dev/md0',
                fsType: 'btrfs',
                totalBytes: 1000 * gib,
                usedBytes: 400 * gib,
                availableBytes: 600 * gib,
                usedPercent: 40,
                isVolume: true,
              },
              {
                mount: '/volume2',
                device: '/dev/md1',
                fsType: 'ext4',
                totalBytes: 1000 * gib,
                usedBytes: 850 * gib,
                availableBytes: 150 * gib,
                usedPercent: 85,
                isVolume: true,
              },
            ],
            docker: { available: false, containers: [] },
          },
        });
      }
      if (url.startsWith('/api/downloaders/summary')) {
        return jsonResponse({
          configured: true,
          mock: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          instances: [
            {
              id: 'qb-1',
              name: 'qB 下载',
              type: 'qbittorrent',
              tags: ['download'],
              online: true,
              checkedAt: '2026-11-27T08:00:00.000Z',
              cached: false,
              version: 'v5.0.0',
              upSpeed: 3 * 1024 * 1024,
              dlSpeed: 1024 * 1024,
              counts: { seeding: 20, downloading: 1, paused: 0, error: 1, stalled: 1, total: 23 },
              totalSize: 1000,
              byTracker: [],
              problems: [],
              problemsTotal: 0,
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
              upSpeed: 2 * 1024 * 1024,
              dlSpeed: 0,
              counts: { seeding: 10, downloading: 0, paused: 0, error: 0, stalled: 1, total: 11 },
              totalSize: 2000,
              byTracker: [],
              problems: [],
              problemsTotal: 0,
            },
          ],
          totals: {
            totalInstances: 2,
            onlineInstances: 2,
            offlineInstances: 0,
            upSpeed: 5 * 1024 * 1024,
            dlSpeed: 1024 * 1024,
            totalSize: 3000,
            counts: { seeding: 30, downloading: 1, paused: 0, error: 1, stalled: 2, total: 34 },
          },
        });
      }
      if (url.startsWith('/api/moviepilot/summary')) {
        return jsonResponse({
          configured: false,
          mock: false,
          online: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
        });
      }
      if (url.startsWith('/api/devices/status')) {
        return jsonResponse({
          configured: false,
          source: 'unconfigured',
          readonly: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          devices: [],
          summary: { total: 0, online: 0, offline: 0 },
          errorCode: 'UNCONFIGURED',
        });
      }
      if (url.endsWith('/api/vps')) {
        return jsonResponse({
          configured: false,
          readonly: false,
          timezone: 'Asia/Shanghai',
          servers: [],
          summary: { total: 0, expired: 0, within7Days: 0, within30Days: 0, invalid: 0 },
          errorCode: 'UNCONFIGURED',
        });
      }
      return jsonResponse({}, 404);
    });

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('demo-nas')).toBeInTheDocument();
    expect(screen.getByText('CPU 21.5% · 内存 50%')).toBeInTheDocument();
    expect(screen.getByText('最高温度 52℃')).toBeInTheDocument();
    expect(screen.getByText('最高卷 /volume2（85%）')).toBeInTheDocument();

    expect(screen.getByText('30 做种')).toBeInTheDocument();
    expect(screen.getByText('上行 5.0 MiB/s · 下行 1.0 MiB/s')).toBeInTheDocument();
    expect(screen.getByText('做种 30 · 出错/卡住 3')).toBeInTheDocument();
    expect(screen.getByText('在线实例 2 / 2')).toBeInTheDocument();

    expect(screen.getByText('未配置，去设置')).toBeInTheDocument();
  });

  it('在线 MoviePilot 汇总卡显示“下载中 N / 待整理 M”', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('/api/moviepilot/summary')) {
        return jsonResponse({
          configured: true,
          mock: false,
          online: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          data: {
            subscribes: [
              {
                id: 1,
                name: '剧集',
                year: '2025',
                type: '电视剧',
                season: 1,
                state: 'R',
                totalEpisode: 10,
                lackEpisode: 1,
                lastUpdate: '',
              },
            ],
            transfers: [],
            transferTotal: 0,
            downloads: [],
            activeDownloads: [],
            activeDownloadsTotal: 3,
            transferQueue: { available: true, items: [], total: 2 },
            transferQueueTotal: 2,
            sites: [],
            downloader: null,
          },
        });
      }
      if (url.startsWith('/api/nas/status') || url.startsWith('/api/downloaders/summary')) {
        return jsonResponse({
          configured: false,
          mock: false,
          online: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
        });
      }
      if (url.startsWith('/api/devices/status')) {
        return jsonResponse({
          configured: false,
          source: 'unconfigured',
          readonly: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          devices: [],
          summary: { total: 0, online: 0, offline: 0 },
          errorCode: 'UNCONFIGURED',
        });
      }
      if (url.endsWith('/api/vps')) {
        return jsonResponse({
          configured: false,
          readonly: false,
          timezone: 'Asia/Shanghai',
          servers: [],
          summary: { total: 0, expired: 0, within7Days: 0, within30Days: 0, invalid: 0 },
          errorCode: 'UNCONFIGURED',
        });
      }
      return jsonResponse({}, 404);
    });

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('1 订阅')).toBeInTheDocument();
    expect(screen.getByText('订阅 1 · 下载中 3 / 待整理 2')).toBeInTheDocument();
  });
});
