import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevicesPage } from '@/pages/DevicesPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const gib = 1024 ** 3;

const SAMPLE_LIST = {
  configured: true,
  source: 'file',
  readonly: false,
  devices: [
    {
      id: 'dev-win',
      name: '客厅主机',
      host: '192.0.2.20',
      port: 22,
      user: 'demo',
      keyPath: './secrets/demo_win_key',
      os: 'windows',
      enabled: true,
      note: '主力台式机',
    },
    {
      id: 'dev-mac',
      name: '书房 Mac mini',
      host: 'demo-mac.local',
      port: 22,
      user: 'demo',
      keyPath: './secrets/demo_mac_key',
      os: 'macos',
      enabled: true,
      note: null,
    },
    {
      id: 'dev-linux',
      name: '备用 Linux',
      host: '192.0.2.30',
      port: 22,
      user: 'demo',
      keyPath: './secrets/demo_linux_key',
      os: 'linux',
      enabled: true,
      note: null,
    },
  ],
};

const SAMPLE_STATUS = {
  configured: true,
  source: 'file',
  readonly: false,
  checkedAt: '2026-11-27T08:00:00.000Z',
  summary: { total: 3, online: 2, offline: 1 },
  devices: [
    {
      id: 'dev-win',
      name: '客厅主机',
      os: 'windows',
      online: true,
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: true,
      data: {
        hostname: 'DEMO-PC',
        os: 'windows',
        osVersion: 'Microsoft Windows 11 Pro 10.0.22631',
        bootTime: '2026-11-24T01:00:00.000Z',
        uptimeSeconds: 3 * 86400 + 7 * 3600,
        cpu: {
          model: 'Demo Processor 12-Core',
          cores: 12,
          loadPercent: 28.5,
        },
        memory: {
          totalBytes: 32 * gib,
          usedBytes: 16 * gib,
          usedPercent: 50,
        },
        disks: [
          {
            mount: 'C:',
            label: '系统盘',
            totalBytes: 500 * gib,
            freeBytes: 200 * gib,
            usedPercent: 60,
          },
          {
            mount: 'D:',
            label: '软件盘',
            totalBytes: 1000 * gib,
            freeBytes: 200 * gib,
            usedPercent: 80,
          },
          {
            mount: 'E:',
            label: '归档盘',
            totalBytes: 2000 * gib,
            freeBytes: 120 * gib,
            usedPercent: 94,
          },
        ],
      },
    },
    {
      id: 'dev-mac',
      name: '书房 Mac mini',
      os: 'macos',
      online: true,
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: false,
      data: {
        hostname: 'DEMO-MAC',
        os: 'macos',
        osVersion: 'macOS 15.1 (24B83)',
        bootTime: '2026-11-15T01:00:00.000Z',
        uptimeSeconds: 12 * 86400 + 4 * 3600,
        cpu: {
          model: 'Apple M2 Pro',
          cores: 10,
          loadPercent: 18.2,
        },
        memory: {
          totalBytes: 16 * gib,
          usedBytes: 8 * gib,
          usedPercent: 50,
        },
        disks: [
          {
            mount: '/System/Volumes/Data',
            label: '系统盘',
            totalBytes: 512 * gib,
            freeBytes: 256 * gib,
            usedPercent: 50,
          },
        ],
      },
    },
    {
      id: 'dev-linux',
      name: '备用 Linux',
      os: 'linux',
      online: false,
      checkedAt: '2026-11-27T08:00:00.000Z',
      cached: false,
      errorCode: 'TIMEOUT',
      error: '连接超时或采集命令执行超时，请检查主机是否在线',
    },
  ],
};

describe('DevicesPage 家用设备页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染多系统设备卡片、图标、进度条阈值、离线 ErrorState 与单卡/整页刷新，且不含重启等操作', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/devices') return jsonResponse(SAMPLE_LIST);
      if (url === '/api/devices/status') return jsonResponse(SAMPLE_STATUS);
      if (url === '/api/devices/dev-win/status?refresh=1') {
        return jsonResponse({ ...SAMPLE_STATUS.devices[0], cached: false });
      }
      if (url === '/api/devices/status?refresh=1') {
        return jsonResponse({
          ...SAMPLE_STATUS,
          devices: SAMPLE_STATUS.devices.map((d) => ({ ...d, cached: false })),
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });

    const { container } = render(<DevicesPage />);

    expect(await screen.findByText('客厅主机')).toBeInTheDocument();
    expect(screen.getByText('书房 Mac mini')).toBeInTheDocument();
    expect(screen.getByText('备用 Linux')).toBeInTheDocument();

    expect(container.querySelector('[data-os="windows"]')).toBeInTheDocument();
    expect(container.querySelector('[data-os="macos"]')).toBeInTheDocument();
    expect(container.querySelector('[data-os="linux"]')).toBeInTheDocument();

    expect(screen.getByText('3 天 7 小时')).toBeInTheDocument();
    expect(screen.getByText('12 天 4 小时')).toBeInTheDocument();
    expect(screen.getByText(/Demo Processor 12-Core \(12 核\)/)).toBeInTheDocument();
    expect(screen.getByText('macOS 15.1 (24B83)')).toBeInTheDocument();

    const cBar = screen.getByRole('progressbar', { name: '客厅主机 C: 磁盘使用率' });
    const dBar = screen.getByRole('progressbar', { name: '客厅主机 D: 磁盘使用率' });
    const eBar = screen.getByRole('progressbar', { name: '客厅主机 E: 磁盘使用率' });
    expect(cBar).toHaveAttribute('data-level', 'normal');
    expect(dBar).toHaveAttribute('data-level', 'warning');
    expect(eBar).toHaveAttribute('data-level', 'danger');

    // 离线设备 ErrorState
    expect(screen.getByRole('alert')).toHaveTextContent('连接超时或采集命令执行超时');

    // 不含重启/关机/休眠等操作按钮
    expect(screen.queryByRole('button', { name: /重启|关机|休眠|执行/ })).not.toBeInTheDocument();

    // 单卡刷新
    await user.click(screen.getByRole('button', { name: '刷新 客厅主机' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/devices/dev-win/status?refresh=1',
      expect.anything(),
    );

    // 整页刷新
    await user.click(screen.getByRole('button', { name: '刷新全部' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/devices/status?refresh=1', expect.anything());
  });

  it('支持添加、测试连接、编辑保存与删除，且提示不上传或显示私钥', async () => {
    const user = userEvent.setup();
    let currentDevices = [...SAMPLE_LIST.devices];

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/devices' && (!init?.method || init.method === 'GET')) {
        return jsonResponse({ ...SAMPLE_LIST, devices: currentDevices });
      }
      if (url.startsWith('/api/devices/status')) {
        return jsonResponse({
          ...SAMPLE_STATUS,
          devices: SAMPLE_STATUS.devices.filter((d) => currentDevices.some((cd) => cd.id === d.id)),
        });
      }
      if (url === '/api/devices/test' && init?.method === 'POST') {
        return jsonResponse({ ok: true, os: 'macos', durationMs: 42 });
      }
      if (url === '/api/devices' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { devices: typeof currentDevices };
        currentDevices = body.devices.map((d, idx) => ({
          ...d,
          id: d.id ?? `new-${idx}`,
        }));
        return jsonResponse({ ...SAMPLE_LIST, devices: currentDevices });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });

    const { container } = render(<DevicesPage />);
    await screen.findByText('客厅主机');

    await user.click(screen.getByRole('button', { name: '添加设备' }));
    expect(screen.getByText('填写服务器上私钥文件的路径，不会上传或显示私钥')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('名称 *'), '测试新 Mac');
    await user.type(screen.getByLabelText('主机 *'), 'demo-new.local');
    await user.type(screen.getByLabelText('用户 *'), 'demo');
    await user.type(screen.getByLabelText('密钥路径 *'), './secrets/demo_new_key');

    // 测试连接
    await user.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('status')).toHaveTextContent('连接测试成功：识别系统 macOS');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/devices/test',
      expect.objectContaining({ method: 'POST' }),
    );

    // 保存新增
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('测试新 Mac')).toBeInTheDocument();

    // 删除新增设备
    await user.click(screen.getByRole('button', { name: '删除 测试新 Mac' }));
    const confirmBtn = screen.getByRole('button', { name: '确认删除' });
    await user.click(confirmBtn);
    expect(screen.queryByText('测试新 Mac')).not.toBeInTheDocument();
  });

  it('只读模式（WIN_SSH_* 迁移或 DEVICES_READONLY）隐藏编辑按钮并显示只读提示', async () => {
    const legacyReason = '当前来自 WIN_SSH_* 环境变量，配置 DEVICES_FILE 后可在界面编辑';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/devices') {
        return jsonResponse({
          configured: true,
          source: 'legacy-windows',
          readonly: true,
          readonlyReason: legacyReason,
          devices: [SAMPLE_LIST.devices[0]],
        });
      }
      if (url === '/api/devices/status') {
        return jsonResponse({
          configured: true,
          source: 'legacy-windows',
          readonly: true,
          readonlyReason: legacyReason,
          checkedAt: '2026-11-27T08:00:00.000Z',
          summary: { total: 1, online: 1, offline: 0 },
          devices: [SAMPLE_STATUS.devices[0]],
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });

    render(<DevicesPage />);
    await screen.findByText('客厅主机');

    expect(within(screen.getByRole('note')).getByText(legacyReason)).toBeInTheDocument();
    expect(screen.getByText('只读模式')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加设备' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });
});
