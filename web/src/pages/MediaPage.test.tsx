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

  it('渲染订阅列表、正在下载（前 5 条+总数）、整理队列（前 5 条+总数）、最近入库与站点状态表', async () => {
    const gib = 1024 * 1024 * 1024;
    const activeDownloads = Array.from({ length: 6 }, (_, idx) => ({
      hash: `dl-${idx}`,
      title: idx === 0 ? '示例下载任务' : `示例下载任务 ${idx + 1}`,
      name: `Demo.Download.${idx + 1}`,
      year: '2025',
      seasonEpisode: `S01E0${idx + 1}`,
      downloader: 'qBittorrent',
      size: 5 * gib,
      progress: 65,
      state: 'downloading',
      dlSpeedText: '8.0 MiB/s',
      upSpeedText: '1.0 MiB/s',
      category: '电影',
      siteName: '示例站点',
      leftTime: '10 分钟',
    }));
    const queueItems = Array.from({ length: 6 }, (_, idx) => ({
      title: `待整理剧集 ${idx + 1}`,
      year: '2025',
      season: `S0${idx + 1}`,
      taskCount: 2,
      stateCounts: { waiting: 1, running: 1 },
      sampleFiles: [`Episode.${idx + 1}.mkv`],
    }));

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
          activeDownloads,
          activeDownloadsTotal: 6,
          transferQueue: {
            available: true,
            items: queueItems,
            total: 6,
          },
          transferQueueTotal: 6,
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
    expect(screen.getByText('正在下载（共 6 个）')).toBeInTheDocument();
    expect(screen.getAllByText('仅显示前 5 条，共 6 条')).toHaveLength(2);
    expect(screen.getByText('示例下载任务')).toBeInTheDocument();
    expect(screen.queryByText('示例下载任务 6')).not.toBeInTheDocument();

    expect(screen.getByText('整理队列（共 6 项）')).toBeInTheDocument();
    expect(screen.getByText('待整理剧集 1 (2025)')).toBeInTheDocument();
    expect(screen.queryByText('待整理剧集 6 (2025)')).not.toBeInTheDocument();
    expect(screen.getByText('Episode.1.mkv')).toBeInTheDocument();
    expect(screen.getAllByText('等待中 1').length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('示例电影 Beta (2025)')).toBeInTheDocument();
    expect(screen.getByText('目标文件已存在')).toBeInTheDocument();
    expect(screen.getByText('pt.example.com')).toBeInTheDocument();
    expect(screen.getByText('50 / 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开始|停止|整理|删除/ })).not.toBeInTheDocument();
  });

  it('整理队列不可用时显示版本提示且不影响其它区块', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: false,
        online: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        data: {
          subscribes: [],
          transfers: [],
          transferTotal: 0,
          downloads: [],
          activeDownloads: [],
          activeDownloadsTotal: 0,
          transferQueue: {
            available: false,
            reason: '当前 MoviePilot 版本不支持整理队列',
            items: [],
            total: 0,
          },
          transferQueueTotal: 0,
          sites: [],
          downloader: null,
        },
      }),
    );

    render(
      <MemoryRouter>
        <MediaPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('当前 MoviePilot 版本不支持整理队列')).toBeInTheDocument();
    expect(screen.getByText('当前没有正在下载的任务')).toBeInTheDocument();
  });
});
