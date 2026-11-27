import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPage } from '@/pages/MediaPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MediaPage 影视页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染订阅列表、正在下载、最近入库与站点状态表', async () => {
    const gib = 1024 * 1024 * 1024;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: true,
        online: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        data: {
          subscribes: [
            {
              id: 1,
              name: '示例剧集 Alpha',
              year: '2025',
              type: '电视剧',
              season: 2,
              state: 'R',
              totalEpisode: 12,
              lackEpisode: 2,
              lastUpdate: '2026-11-27 10:00:00',
            },
          ],
          transfers: [
            {
              title: '示例电影 Beta',
              year: '2025',
              type: '电影',
              seasons: '',
              episodes: '',
              status: false,
              errmsg: '目标文件已存在',
              date: '2026-11-27 09:00:00',
              category: '电影',
            },
          ],
          transferTotal: 1,
          downloads: [
            {
              title: '示例下载任务',
              name: 'Demo.Download',
              siteName: '示例站点',
              size: 5 * gib,
              progress: 65,
              state: 'downloading',
              dlSpeed: 8 * 1024 * 1024,
              upSpeed: 1024 * 1024,
              leftTime: '10 分钟',
              downloader: 'qBittorrent',
            },
          ],
          sites: [
            {
              id: 1,
              name: '示例站点',
              domain: 'pt.example.com',
              isActive: true,
              priority: 1,
              successCount: 50,
              failCount: 1,
              avgSeconds: 0.45,
              lastState: 'success',
              lastModDate: '2026-11-27 10:30:00',
            },
          ],
          downloader: null,
        },
      }),
    );

    render(
      <MemoryRouter>
        <MediaPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('示例剧集 Alpha (2025)')).toBeInTheDocument();
    expect(screen.getByText('（缺 2 集）')).toBeInTheDocument();
    expect(screen.getByText('示例下载任务')).toBeInTheDocument();
    expect(screen.getByText('示例电影 Beta (2025)')).toBeInTheDocument();
    expect(screen.getByText('目标文件已存在')).toBeInTheDocument();
    expect(screen.getByText('pt.example.com')).toBeInTheDocument();
    expect(screen.getByText('50 / 1')).toBeInTheDocument();
  });
});
