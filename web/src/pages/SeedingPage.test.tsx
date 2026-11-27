import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeedingPage } from '@/pages/SeedingPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SeedingPage 多实例下载器页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未配置时引导前往设置页', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: false,
        mock: false,
        checkedAt: '2026-11-27T08:00:00.000Z',
        instances: [],
        totals: {
          totalInstances: 0,
          onlineInstances: 0,
          offlineInstances: 0,
          upSpeed: 0,
          dlSpeed: 0,
          totalSize: 0,
          counts: { seeding: 0, downloading: 0, paused: 0, error: 0, stalled: 0, total: 0 },
        },
      }),
    );

    render(
      <MemoryRouter>
        <SeedingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('尚未配置下载器')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往设置' })).toHaveAttribute('href', '/settings');
  });

  it('渲染多实例下载器卡片网格（类型徽章、用途标签、速度、做种/下载、体积与详情链接）且无控制按钮', async () => {
    const gib = 1024 * 1024 * 1024;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        totals: {
          totalInstances: 2,
          onlineInstances: 2,
          offlineInstances: 0,
          upSpeed: 15 * 1024 * 1024,
          dlSpeed: 3 * 1024 * 1024,
          totalSize: 900 * gib,
          counts: { seeding: 50, downloading: 3, paused: 1, error: 1, stalled: 0, total: 55 },
        },
        instances: [
          {
            id: 'qb-dl',
            name: 'qB 下载',
            type: 'qbittorrent',
            tags: ['download', 'brush'],
            online: true,
            checkedAt: '2026-11-27T08:00:00.000Z',
            cached: false,
            version: 'v5.0.2',
            upSpeed: 10 * 1024 * 1024,
            dlSpeed: 3 * 1024 * 1024,
            counts: { seeding: 12, downloading: 3, paused: 0, error: 1, stalled: 0, total: 16 },
            totalSize: 300 * gib,
            byTracker: [],
            byCategory: [],
            problems: [],
            problemsTotal: 0,
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
            upSpeed: 5 * 1024 * 1024,
            dlSpeed: 0,
            counts: { seeding: 38, downloading: 0, paused: 1, error: 0, stalled: 0, total: 39 },
            totalSize: 600 * gib,
            byTracker: [],
            byLabel: [],
            problems: [],
            problemsTotal: 0,
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <SeedingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('qB 下载')).toBeInTheDocument();
    expect(screen.getByText('TR 保种')).toBeInTheDocument();
    expect(screen.getByText('qB')).toBeInTheDocument();
    expect(screen.getByText('TR')).toBeInTheDocument();
    expect(screen.getByText('下载')).toBeInTheDocument();
    expect(screen.getByText('刷流')).toBeInTheDocument();
    expect(screen.getByText('保种')).toBeInTheDocument();
    expect(screen.getByText('10.0 MiB/s')).toBeInTheDocument();
    expect(screen.getByText('300.0 GiB')).toBeInTheDocument();
    expect(screen.getByText('600.0 GiB')).toBeInTheDocument();
    expect(screen.getByText('在线实例 2 / 2')).toBeInTheDocument();

    const detailLinks = screen.getAllByRole('link');
    expect(detailLinks[0]).toHaveAttribute('href', '/seeding/qb-dl');
    expect(detailLinks[1]).toHaveAttribute('href', '/seeding/tr-seed');

    expect(screen.queryByRole('button', { name: /暂停|恢复|删除|添加/ })).not.toBeInTheDocument();
  });
});
