import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrushPage } from '@/pages/BrushPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BrushPage 刷流页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('仅显示带 brush 标签的实例卡片与活跃任务，过滤 download/seed 实例', async () => {
    const gib = 1024 * 1024 * 1024;
    const mib = 1024 * 1024;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        totals: {
          totalInstances: 3,
          onlineInstances: 3,
          offlineInstances: 0,
          upSpeed: 40 * mib,
          dlSpeed: 10 * mib,
          totalSize: 2000 * gib,
          counts: { seeding: 100, downloading: 3, paused: 0, error: 0, stalled: 0, total: 103 },
        },
        instances: [
          {
            id: 'qb-dl',
            name: 'qB 下载',
            type: 'qbittorrent',
            tags: ['download'],
            online: true,
            checkedAt: '2026-11-27T08:00:00.000Z',
            cached: false,
            version: 'v5.0.2',
            upSpeed: 5 * mib,
            dlSpeed: 5 * mib,
            counts: { seeding: 10, downloading: 1, paused: 0, error: 0, stalled: 0, total: 11 },
            totalSize: 200 * gib,
            byTracker: [],
            byCategory: [],
            problems: [],
            problemsTotal: 0,
            activeTasks: [
              {
                name: 'Download.Only.Task',
                state: '下载中',
                progress: 0.5,
                dlSpeed: 5 * mib,
                upSpeed: 1 * mib,
                eta: 100,
                size: 10 * gib,
                ratio: 0.2,
              },
            ],
            activeTotal: 1,
          },
          {
            id: 'qb-brush',
            name: 'qB 刷流',
            type: 'qbittorrent',
            tags: ['brush'],
            online: true,
            checkedAt: '2026-11-27T08:00:00.000Z',
            cached: false,
            version: 'v5.0.2',
            upSpeed: 28 * mib,
            dlSpeed: 5 * mib,
            counts: { seeding: 30, downloading: 2, paused: 0, error: 0, stalled: 0, total: 32 },
            totalSize: 800 * gib,
            byTracker: [],
            byCategory: [],
            problems: [],
            problemsTotal: 0,
            activeTasks: [
              {
                name: 'Freeleech.Brush.Pack.2026',
                state: '下载中',
                progress: 0.6,
                dlSpeed: 5 * mib,
                upSpeed: 20 * mib,
                eta: 600,
                size: 50 * gib,
                ratio: 1.8,
              },
            ],
            activeTotal: 1,
          },
          {
            id: 'tr-seed',
            name: 'TR 保种',
            type: 'transmission',
            tags: ['seed'],
            online: true,
            checkedAt: '2026-11-27T08:00:00.000Z',
            cached: false,
            version: '4.0.6',
            upSpeed: 7 * mib,
            dlSpeed: 0,
            counts: { seeding: 60, downloading: 0, paused: 0, error: 0, stalled: 0, total: 60 },
            totalSize: 1000 * gib,
            byTracker: [],
            byLabel: [],
            problems: [],
            problemsTotal: 0,
            activeTasks: [],
            activeTotal: 0,
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <BrushPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('qB 刷流')).toBeInTheDocument();
    expect(screen.getByText('Freeleech.Brush.Pack.2026')).toBeInTheDocument();
    expect(screen.getByText('在线实例 1 / 1')).toBeInTheDocument();
    expect(screen.queryByText('qB 下载')).not.toBeInTheDocument();
    expect(screen.queryByText('Download.Only.Task')).not.toBeInTheDocument();
    expect(screen.queryByText('TR 保种')).not.toBeInTheDocument();
  });

  it('没有刷流标签实例时展示空状态引导', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: false,
        checkedAt: '2026-11-27T08:00:00.000Z',
        totals: {
          totalInstances: 1,
          onlineInstances: 1,
          offlineInstances: 0,
          upSpeed: 0,
          dlSpeed: 0,
          totalSize: 0,
          counts: { seeding: 0, downloading: 0, paused: 0, error: 0, stalled: 0, total: 0 },
        },
        instances: [
          {
            id: 'qb-dl',
            name: 'qB 下载',
            type: 'qbittorrent',
            tags: ['download'],
            online: true,
            checkedAt: '2026-11-27T08:00:00.000Z',
            cached: false,
            version: 'v5.0.2',
            upSpeed: 0,
            dlSpeed: 0,
            counts: { seeding: 0, downloading: 0, paused: 0, error: 0, stalled: 0, total: 0 },
            totalSize: 0,
            byTracker: [],
            byCategory: [],
            problems: [],
            problemsTotal: 0,
            activeTasks: [],
            activeTotal: 0,
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <BrushPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('暂无刷流下载器实例')).toBeInTheDocument();
  });
});
