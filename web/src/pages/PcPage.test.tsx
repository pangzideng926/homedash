import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PcPage } from '@/pages/PcPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const gib = 1024 ** 3;

const SAMPLE_PC_ONLINE = {
  online: true,
  checkedAt: '2026-11-27T08:00:00.000Z',
  cached: true,
  data: {
    hostname: 'DEMO-PC',
    os: 'Microsoft Windows 11 Pro 10.0.22631',
    bootTime: '2026-11-24T01:00:00.000Z',
    uptimeSeconds: 3 * 86400 + 7 * 3600,
    cpu: {
      model: 'Demo Processor 12-Core',
      loadPercent: 28.5,
    },
    memory: {
      totalBytes: 32 * gib,
      freeBytes: 16 * gib,
      usedPercent: 50,
    },
    disks: [
      {
        drive: 'C:',
        label: '系统盘',
        totalBytes: 500 * gib,
        freeBytes: 200 * gib,
        usedPercent: 60,
      },
      {
        drive: 'D:',
        label: '软件盘',
        totalBytes: 1000 * gib,
        freeBytes: 200 * gib,
        usedPercent: 80,
      },
      {
        drive: 'E:',
        label: '归档盘',
        totalBytes: 2000 * gib,
        freeBytes: 120 * gib,
        usedPercent: 94,
      },
    ],
  },
};

describe('PcPage 家用电脑页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染在线状态、中文开机时长、CPU/内存/磁盘进度条及阈值颜色，且不含操作按钮', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(SAMPLE_PC_ONLINE))
      .mockResolvedValueOnce(
        jsonResponse({
          ...SAMPLE_PC_ONLINE,
          cached: false,
        }),
      );

    render(<PcPage />);

    expect(await screen.findByText('在线')).toBeInTheDocument();
    expect(screen.getByText('已缓存')).toBeInTheDocument();
    expect(screen.getAllByText('DEMO-PC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('3 天 7 小时')).toBeInTheDocument();
    expect(screen.getByText('Demo Processor 12-Core')).toBeInTheDocument();

    const cBar = screen.getByRole('progressbar', { name: 'C: 磁盘使用率' });
    const dBar = screen.getByRole('progressbar', { name: 'D: 磁盘使用率' });
    const eBar = screen.getByRole('progressbar', { name: 'E: 磁盘使用率' });
    expect(cBar).toHaveAttribute('data-level', 'normal');
    expect(dBar).toHaveAttribute('data-level', 'warning');
    expect(eBar).toHaveAttribute('data-level', 'danger');

    // 不包含重启/关机等修改远端操作按钮
    expect(screen.queryByRole('button', { name: /重启|关机|休眠|执行/ })).not.toBeInTheDocument();

    // 点击刷新触发 ?refresh=1
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText('实时采集')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/windows/status?refresh=1');
  });

  it('离线或采集失败时展示离线徽章与 ErrorState 中文原因', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        online: false,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        errorCode: 'TIMEOUT',
        error: '连接超时或采集命令执行超时，请检查主机是否在线',
      }),
    );

    render(<PcPage />);

    expect(await screen.findByText('离线')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('连接超时或采集命令执行超时');
  });
});
