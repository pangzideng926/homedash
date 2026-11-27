import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPage } from '@/pages/MediaPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MediaPage 影视模块三页签', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染总览页签统计条、最近入库海报墙与 warnings，并支持切换正在下载与订阅追剧页签', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const gib = 1024 * 1024 * 1024;
    const mib = 1024 * 1024;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('/api/media/overview')) {
        return jsonResponse({
          configured: true,
          mock: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          warnings: ['MoviePilot 整理队列暂时不可用'],
          stats: {
            downloading: 2,
            pendingTransfer: 3,
            todayImported: 5,
            todayImportedApproximate: false,
            seeding: 88,
            seedUploadSpeed: 10 * mib,
            seedTotalUploaded: 500 * gib,
            library: { movieCount: 200, tvCount: 40, episodeCount: 1200 },
          },
          recent: [
            {
              title: '示例剧集 Alpha',
              year: '2026',
              type: '电视剧',
              season: 'S01',
              episodes: 'E03-E05',
              episodeCount: 3,
              date: '2026-11-27 06:00:00',
              importedAt: new Date(now - 2 * 3600_000).toISOString(),
              posterUrl: null,
            },
          ],
        });
      }
      if (url.startsWith('/api/media/downloads')) {
        return jsonResponse({
          configured: true,
          mock: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          warnings: [],
          items: [
            {
              hash: 'h1',
              displayName: '示例下载剧集',
              torrentName: 'Demo.Series.S02E01',
              year: '2026',
              seasonEpisode: 'S02E01',
              posterUrl: null,
              progress: 0.72,
              dlSpeed: 8 * mib,
              upSpeed: 1 * mib,
              dlSpeedText: null,
              upSpeedText: null,
              eta: 180,
              leftTime: null,
              size: 4 * gib,
              state: '下载中',
              instanceName: 'qB 下载',
              site: '站点甲',
              matched: true,
            },
            {
              hash: 'h2',
              displayName: 'Unmatched Movie 2026',
              torrentName: '[Demo].Unmatched.Movie.2026',
              year: '',
              seasonEpisode: '',
              posterUrl: null,
              progress: 0.2,
              dlSpeed: 0,
              upSpeed: 0,
              dlSpeedText: null,
              upSpeedText: null,
              eta: null,
              leftTime: null,
              size: 8 * gib,
              state: '等待连接',
              instanceName: 'qB 下载',
              site: '',
              matched: false,
            },
          ],
        });
      }
      if (url.startsWith('/api/media/subscriptions')) {
        return jsonResponse({
          configured: true,
          mock: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          cached: false,
          calendarAvailable: true,
          warnings: [],
          items: [
            {
              id: 1,
              name: '追剧 Beta',
              year: '2026',
              type: '电视剧',
              season: 1,
              posterUrl: null,
              state: '订阅中',
              totalEpisode: 12,
              startEpisode: 1,
              completedEpisode: 5,
              lackEpisode: 7,
              downloadedEpisodes: [1, 2, 4, 6, 7],
              latestEpisode: 7,
              missingEpisodes: [3, 5, 8, 9, 10, 11, 12],
              missingInferred: false,
              nextAir: { date: '2026-11-30', episodeNumber: 8, name: '第 8 集' },
              hasAired: null,
              lastUpdate: '2026-11-27 10:00:00',
            },
            {
              id: 2,
              name: '待映电影 Gamma',
              year: '2026',
              type: '电影',
              season: null,
              posterUrl: null,
              state: '订阅中',
              totalEpisode: 1,
              startEpisode: 1,
              completedEpisode: 0,
              lackEpisode: 1,
              downloadedEpisodes: [],
              latestEpisode: null,
              missingEpisodes: [],
              missingInferred: false,
              nextAir: null,
              hasAired: false,
              lastUpdate: '2026-11-26 10:00:00',
            },
            {
              id: 3,
              name: '已映电影 Delta',
              year: '2025',
              type: '电影',
              season: null,
              posterUrl: null,
              state: '订阅中',
              totalEpisode: 1,
              startEpisode: 1,
              completedEpisode: 0,
              lackEpisode: 1,
              downloadedEpisodes: [],
              latestEpisode: null,
              missingEpisodes: [],
              missingInferred: false,
              nextAir: null,
              hasAired: true,
              lastUpdate: '2026-11-25 10:00:00',
            },
          ],
        });
      }
      return jsonResponse({ error: 'Not Found' }, 404);
    });

    render(
      <MemoryRouter>
        <MediaPage />
      </MemoryRouter>,
    );

    // 总览页签
    expect(await screen.findByText('MoviePilot 整理队列暂时不可用')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('总上传 500.0 GiB')).toBeInTheDocument();
    expect(screen.getByText('示例剧集 Alpha')).toBeInTheDocument();
    expect(screen.getByText('S01 E03-E05')).toBeInTheDocument();
    expect(screen.getByText('2 小时前')).toBeInTheDocument();
    expect(screen.getByLabelText('示例剧集 Alpha 海报占位')).toHaveTextContent('示');

    // 切换正在下载页签
    await user.click(screen.getByRole('tab', { name: '正在下载' }));
    expect(await screen.findByText('示例下载剧集')).toBeInTheDocument();
    expect(screen.getByText('S02E01')).toBeInTheDocument();
    expect(screen.getByText('Unmatched Movie 2026')).toBeInTheDocument();
    expect(screen.getByText('未识别')).toBeInTheDocument();

    // 切换订阅追剧页签
    await user.click(screen.getByRole('tab', { name: '订阅追剧' }));
    expect(await screen.findByText('追剧 Beta (2026)')).toBeInTheDocument();
    expect(screen.getByText('已更新到第 7 集 / 共 12 集')).toBeInTheDocument();
    expect(screen.getByText('缺 E03、E05、E08、E09、E10、E11 + 更多')).toBeInTheDocument();
    expect(screen.getByText('下一集：周一 11/30 第 8 集')).toBeInTheDocument();
    expect(screen.getByText('待上映')).toBeInTheDocument();
    expect(screen.getByText('已上映未入库')).toBeInTheDocument();
    expect(screen.getAllByText(/暂无排期/).length).toBeGreaterThanOrEqual(1);
  });

  it('正在下载页签无任务时展示空状态“当前没有下载任务”', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: false,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        warnings: [],
        items: [],
      }),
    );

    render(
      <MemoryRouter initialEntries={['/media?tab=downloads']}>
        <MediaPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('当前没有下载任务')).toBeInTheDocument();
    });
  });
});
