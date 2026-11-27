import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NasPage } from '@/pages/NasPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildSampleNasResponse(dockerOverride?: Record<string, unknown>) {
  const gib = 1024 * 1024 * 1024;
  return {
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
      docker: dockerOverride ?? {
        available: false,
        reason: '当前账号无权访问 Docker（需要加入 docker 组），已跳过',
        containers: [],
      },
    },
  };
}

describe('NasPage NAS 监控与 Docker 容器管理页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染系统信息、温度颜色、RAID 降级徽章、卷使用率与 Docker 权限不足提示', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(buildSampleNasResponse()));

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

  it('DOCKER_ACTIONS_ENABLED=false 时隐藏启停重启按钮并提示未开启，日志仍可查看', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/logs')) {
        return jsonResponse({
          container: 'qbittorrent',
          tail: 200,
          logs: '2026-11-27T08:00:00Z demo log line',
          fetchedAt: '2026-11-27T08:00:00.000Z',
        });
      }
      return jsonResponse(
        buildSampleNasResponse({
          available: true,
          actionsEnabled: false,
          protectedContainers: ['homedash'],
          containers: [
            {
              id: 'c1',
              name: 'qbittorrent',
              image: 'linuxserver/qbittorrent:latest',
              state: 'running',
              status: 'Up 2 days',
              runningFor: '2 days ago',
              ports: '0.0.0.0:8080->8080/tcp',
              cpuPercent: '3.20%',
              memUsage: '256MiB / 16GiB',
              memPercent: '1.56%',
              protected: false,
            },
          ],
        }),
      );
    });

    render(
      <MemoryRouter>
        <NasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('qbittorrent')).toBeInTheDocument();
    expect(screen.getByText('Docker 操作未开启')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止 qbittorrent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重启 qbittorrent' })).not.toBeInTheDocument();

    // 日志弹窗可用
    await user.click(screen.getByRole('button', { name: '日志 qbittorrent' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('demo log line');
  });

  it('渲染受保护徽章、停止二次确认、日志 tail 切换与审计记录折叠查看', async () => {
    const user = userEvent.setup();
    const calledUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calledUrls.push(url);
      if (url.includes('/api/nas/docker/qbittorrent/stop')) {
        return jsonResponse({
          ok: true,
          container: 'qbittorrent',
          action: 'stop',
          message: '容器 qbittorrent 停止成功',
          durationMs: 120,
        });
      }
      if (url.includes('/api/nas/docker/qbittorrent/logs')) {
        const tail = url.includes('tail=500') ? 500 : 200;
        return jsonResponse({
          container: 'qbittorrent',
          tail,
          logs: `log output tail=${tail}`,
          fetchedAt: '2026-11-27T08:00:00.000Z',
        });
      }
      if (url.includes('/api/nas/docker/audit')) {
        return jsonResponse({
          total: 1,
          entries: [
            {
              timestamp: '2026-11-27T08:00:00.000Z',
              username: 'admin',
              clientIp: '192.0.2.5',
              container: 'qbittorrent',
              action: 'stop',
              result: 'success',
              durationMs: 120,
            },
          ],
        });
      }
      return jsonResponse(
        buildSampleNasResponse({
          available: true,
          actionsEnabled: true,
          protectedContainers: ['homedash'],
          containers: [
            {
              id: 'c0',
              name: 'homedash',
              image: 'homedash:latest',
              state: 'running',
              status: 'Up 10 days',
              runningFor: '10 days ago',
              ports: '0.0.0.0:3000->3000/tcp',
              cpuPercent: '0.40%',
              memUsage: '64MiB / 16GiB',
              memPercent: '0.39%',
              protected: true,
            },
            {
              id: 'c1',
              name: 'qbittorrent',
              image: 'linuxserver/qbittorrent:latest',
              state: 'running',
              status: 'Up 2 days',
              runningFor: '2 days ago',
              ports: '0.0.0.0:8080->8080/tcp',
              cpuPercent: '3.20%',
              memUsage: '256MiB / 16GiB',
              memPercent: '1.56%',
              protected: false,
            },
          ],
        }),
      );
    });

    render(
      <MemoryRouter>
        <NasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('受保护')).toBeInTheDocument();
    expect(screen.getByText('3.20%')).toBeInTheDocument();
    // homedash 受保护，不显示停止/重启按钮
    expect(screen.queryByRole('button', { name: '停止 homedash' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重启 homedash' })).not.toBeInTheDocument();

    // 点击停止 qbittorrent -> 弹出二次确认对话框 -> 点击确认停止
    await user.click(screen.getByRole('button', { name: '停止 qbittorrent' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('qbittorrent');
    await user.click(screen.getByRole('button', { name: '确认停止' }));
    expect(await screen.findByText('容器 qbittorrent 停止成功')).toBeInTheDocument();

    // 打开日志并切换 tail=500
    await user.click(screen.getByRole('button', { name: '日志 qbittorrent' }));
    expect(await screen.findByText('log output tail=200')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('行数'), '500');
    expect(await screen.findByText('log output tail=500')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭日志弹窗' }));

    // 展开底部审计记录
    await user.click(screen.getByRole('button', { name: '查看最近 20 条审计记录' }));
    expect(await screen.findByText('192.0.2.5')).toBeInTheDocument();
    expect(calledUrls.some((u) => u.includes('/api/nas/docker/audit?limit=20'))).toBe(true);
  });
});
