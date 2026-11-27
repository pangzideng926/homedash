import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NasPage } from '@/pages/NasPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NasPage NAS 监控页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染系统信息、温度颜色、RAID 降级徽章、卷使用率与 Docker 容器', async () => {
    const gib = 1024 * 1024 * 1024;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        mock: true,
        online: true,
        checkedAt: '2026-11-27T08:00:00.000Z',
        cached: false,
        data: {
          hostname: 'demo-nas',
          osVersion: 'Debian GNU/Linux 12 (bookworm)',
          uptimeSeconds: 86400,
          bootTime: '2026-11-26T08:00:00.000Z',
          loadAvg: [0.32, 0.41, 0.35],
          cpu: { model: 'Demo CPU', cores: 4, loadPercent: 22.5 },
          memory: {
            totalBytes: 16 * gib,
            usedBytes: 8 * gib,
            availableBytes: 8 * gib,
            usedPercent: 50,
          },
          temperatures: [
            {
              category: 'cpu',
              label: 'CPU',
              maxTempC: 74,
              sensors: [{ name: 'coretemp', tempC: 74 }],
            },
          ],
          maxTemperatureC: 74,
          smart: { available: false, reason: '需要 root 权限，已跳过', disks: [] },
          raids: [
            {
              name: 'md0',
              status: 'active',
              level: 'raid1',
              members: ['sda1[0]', 'sdb1[1](F)'],
              stateFlags: '[U_]',
              activeDevices: 1,
              totalDevices: 2,
              healthy: false,
              statusLabel: '降级',
            },
          ],
          volumes: [
            {
              mount: '/volume1',
              device: '/dev/md0',
              fsType: 'btrfs',
              totalBytes: 1000 * gib,
              usedBytes: 910 * gib,
              availableBytes: 90 * gib,
              usedPercent: 91,
              isVolume: true,
            },
          ],
          docker: {
            available: false,
            reason: '当前账号无权访问 Docker（需要加入 docker 组），已跳过',
            containers: [],
          },
        },
      }),
    );

    render(
      <MemoryRouter>
        <NasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('demo-nas')).toBeInTheDocument();
    expect(screen.getByText('Debian GNU/Linux 12 (bookworm)')).toBeInTheDocument();
    expect(screen.getByText('74℃')).toBeInTheDocument();
    expect(screen.getByText(/需要 root 权限，已跳过/)).toBeInTheDocument();
    expect(screen.getByText('md0')).toBeInTheDocument();
    expect(screen.getByText('降级')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '/volume1 使用率' })).toHaveAttribute(
      'data-level',
      'danger',
    );
    expect(
      screen.getByText('当前账号无权访问 Docker（需要加入 docker 组），已跳过'),
    ).toBeInTheDocument();
  });
});
