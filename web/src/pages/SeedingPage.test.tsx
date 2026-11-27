import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeedingPage } from '@/pages/SeedingPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SeedingPage 下载与做种页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未配置时引导前往设置页', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: false,
        mock: false,
        online: false,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
      }),
    );

    render(
      <MemoryRouter>
        <SeedingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('尚未配置 qBittorrent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往设置' })).toHaveAttribute('href', '/settings');
  });

  it('渲染速度、总量、状态徽章、Tracker/分类切换与问题种子，且无写操作按钮', async () => {
    const user = userEvent.setup();
    const gib = 1024 * 1024 * 1024;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: true,
        online: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        data: {
          version: 'v5.0.2',
          transfer: {
            upSpeed: 10 * 1024 * 1024,
            dlSpeed: 2 * 1024 * 1024,
            alltimeUploadBytes: 500 * gib,
            alltimeDownloadBytes: 100 * gib,
            globalRatio: 5,
            totalsApproximate: false,
          },
          counts: {
            seeding: 12,
            downloading: 1,
            paused: 2,
            error: 1,
            stalled: 1,
            other: 0,
            total: 17,
          },
          byTracker: [
            {
              name: 'alpha.example.com',
              seedingCount: 10,
              totalCount: 12,
              totalSizeBytes: 80 * gib,
            },
          ],
          byCategory: [
            { name: 'movies', seedingCount: 8, totalCount: 9, totalSizeBytes: 60 * gib },
          ],
          problemTorrents: [
            {
              hash: 'h1',
              name: 'Demo.Problem.Torrent',
              state: 'stalledDL',
              reason: '下载卡住（无可用连接）',
              sizeBytes: 10 * gib,
              trackerDomain: 'alpha.example.com',
              category: 'movies',
              progress: 40,
            },
          ],
          problemTorrentsTotal: 1,
        },
      }),
    );

    render(
      <MemoryRouter>
        <SeedingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('10.0 MiB/s')).toBeInTheDocument();
    expect(screen.getByText('2.0 MiB/s')).toBeInTheDocument();
    expect(screen.getByText('做种中 12')).toBeInTheDocument();
    expect(screen.getAllByText('alpha.example.com').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Demo.Problem.Torrent')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '按分类' }));
    expect(screen.getAllByRole('columnheader', { name: '分类' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('60.0 GiB')).toBeInTheDocument();

    // 不提供任何控制操作按钮
    expect(screen.queryByRole('button', { name: /暂停|恢复|删除|添加/ })).not.toBeInTheDocument();
  });
});
