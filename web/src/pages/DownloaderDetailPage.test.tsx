import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloaderDetailPage } from '@/pages/DownloaderDetailPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DownloaderDetailPage 下载器详情页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染 Transmission 实例详情（状态分布、按 Tracker/按标签切换、问题种子）且无写操作按钮', async () => {
    const user = userEvent.setup();
    const gib = 1024 * 1024 * 1024;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        id: 'tr-seed',
        name: 'TR 保种',
        type: 'transmission',
        tags: ['seed'],
        online: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        version: '4.0.6',
        upSpeed: 8 * 1024 * 1024,
        dlSpeed: 0,
        totalUploaded: 500 * gib,
        totalDownloaded: 100 * gib,
        ratio: 5,
        totalsApproximate: false,
        counts: { seeding: 40, downloading: 0, paused: 2, error: 1, stalled: 1, total: 44 },
        totalSize: 800 * gib,
        byTracker: [{ domain: 'alpha.example.com', count: 44, seedingCount: 40, size: 800 * gib }],
        byLabel: [{ name: 'archive', count: 30, seedingCount: 28, size: 600 * gib }],
        problems: [
          {
            id: '101',
            name: 'Demo.Problem.Torrent',
            state: 'error',
            reason: '出错：Tracker unregistered',
            size: 12 * gib,
            trackerDomain: 'alpha.example.com',
            group: 'archive',
            progress: 100,
          },
        ],
        problemsTotal: 1,
        activeTasks: [
          {
            name: 'Demo.Active.Seed.Torrent',
            state: '做种中',
            progress: 1,
            dlSpeed: 0,
            upSpeed: 8 * 1024 * 1024,
            eta: null,
            size: 24 * gib,
            ratio: 4.5,
            label: 'archive',
          },
        ],
        activeTotal: 15,
      }),
    );

    render(
      <MemoryRouter initialEntries={['/seeding/tr-seed']}>
        <Routes>
          <Route path="/seeding/:id" element={<DownloaderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'TR 保种' })).toBeInTheDocument();
    expect(screen.getByText('TR')).toBeInTheDocument();
    expect(screen.getByText('保种')).toBeInTheDocument();
    expect(screen.getAllByText('8.0 MiB/s').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('做种中 40')).toBeInTheDocument();
    expect(screen.getByText('Demo.Problem.Torrent')).toBeInTheDocument();
    expect(screen.getByText('进行中的任务（共 15 个）')).toBeInTheDocument();
    expect(screen.getByText('Demo.Active.Seed.Torrent')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/downloaders/tr-seed/summary?activeLimit=10',
      expect.any(Object),
    );

    await user.click(screen.getByRole('button', { name: '20 条' }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/downloaders/tr-seed/summary?activeLimit=20',
        expect.any(Object),
      );
    });

    await user.click(screen.getByRole('button', { name: '按标签' }));
    expect(screen.getAllByText('archive').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('600.0 GiB')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /暂停|恢复|删除|添加/ })).not.toBeInTheDocument();
  });

  it('无进行中任务时展示空状态提示', async () => {
    const gib = 1024 * 1024 * 1024;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        id: 'qb-empty',
        name: 'qB 空闲',
        type: 'qbittorrent',
        tags: ['download'],
        online: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        version: 'v5.0.2',
        upSpeed: 0,
        dlSpeed: 0,
        counts: { seeding: 0, downloading: 0, paused: 0, error: 0, stalled: 0, total: 0 },
        totalSize: 0 * gib,
        byTracker: [],
        byCategory: [],
        problems: [],
        problemsTotal: 0,
        activeTasks: [],
        activeTotal: 0,
      }),
    );

    render(
      <MemoryRouter initialEntries={['/seeding/qb-empty']}>
        <Routes>
          <Route path="/seeding/:id" element={<DownloaderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('进行中的任务（共 0 个）')).toBeInTheDocument();
    expect(screen.getByText('暂无进行中的任务')).toBeInTheDocument();
  });
});
