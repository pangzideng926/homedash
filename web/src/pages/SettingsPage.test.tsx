import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '@/pages/SettingsPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SettingsPage 设置状态页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中时展示骨架屏加载状态', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));

    render(<SettingsPage />);

    expect(screen.getByRole('status')).toHaveTextContent('正在加载配置状态...');
  });

  it('渲染已配置、未配置、配置不完整状态及各键已填/未填状态且不暴露任何值', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        modules: {
          auth: {
            id: 'auth',
            label: '认证与会话',
            status: 'configured',
            statusLabel: '已配置',
            keys: {
              ADMIN_USERNAME: true,
              SESSION_SECRET: true,
            },
          },
          nas: {
            id: 'nas',
            label: 'NAS',
            status: 'unconfigured',
            statusLabel: '未配置',
            keys: {
              NAS_SSH_HOST: false,
              NAS_SSH_PORT: false,
            },
          },
          qbittorrent: {
            id: 'qbittorrent',
            label: 'qBittorrent',
            status: 'incomplete',
            statusLabel: '配置不完整',
            keys: {
              QBIT_URL: true,
              QBIT_PASSWORD: false,
            },
          },
        },
      }),
    );

    const { container } = render(<SettingsPage />);

    expect(await screen.findByText('认证与会话')).toBeInTheDocument();
    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.getByText('未配置')).toBeInTheDocument();
    expect(screen.getByText('配置不完整')).toBeInTheDocument();

    expect(screen.getByText('ADMIN_USERNAME')).toBeInTheDocument();
    expect(screen.getByText('SESSION_SECRET')).toBeInTheDocument();
    expect(screen.getByText('NAS_SSH_HOST')).toBeInTheDocument();
    expect(screen.getByText('QBIT_PASSWORD')).toBeInTheDocument();

    expect(screen.getAllByText('已填')).toHaveLength(3);
    expect(screen.getAllByText('未填')).toHaveLength(3);

    expect(container.textContent).not.toContain('true');
    expect(container.textContent).not.toContain('false');
  });

  it('请求失败时展示中文错误提示并支持点击重试', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: '服务暂时不可用' }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          modules: {
            app: {
              id: 'app',
              label: '应用基础',
              status: 'configured',
              statusLabel: '已配置',
              keys: { PORT: true },
            },
          },
        }),
      );

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用');

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('应用基础')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
