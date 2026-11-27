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
    let statusAttempt = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/integrations')) {
        return jsonResponse({ modules: {} });
      }
      statusAttempt += 1;
      if (statusAttempt === 1) {
        return jsonResponse({ error: '服务暂时不可用' }, 503);
      }
      return jsonResponse({
        modules: {
          app: {
            id: 'app',
            label: '应用基础',
            status: 'configured',
            statusLabel: '已配置',
            keys: { PORT: true },
          },
        },
      });
    });

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用');

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('应用基础')).toBeInTheDocument();
    expect(statusAttempt).toBe(2);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('集成配置区展示已设置状态、清除按钮、.env 只读与测试连接/保存交互', async () => {
    const user = userEvent.setup();
    const putBodies: Array<{ url: string; body: unknown }> = [];
    const testBodies: Array<{ url: string; body: unknown }> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.endsWith('/api/settings/status')) {
        return jsonResponse({
          modules: {
            nas: {
              id: 'nas',
              label: 'NAS',
              status: 'configured',
              statusLabel: '已配置',
              keys: { NAS_SSH_HOST: true },
            },
          },
        });
      }

      if (url.endsWith('/api/integrations') && method === 'GET') {
        return jsonResponse({
          fileConfigured: true,
          modules: {
            nas: {
              configured: true,
              mock: false,
              fields: {
                host: { source: 'env', set: true, value: '192.0.2.10' },
                port: { source: 'file', set: true, value: 22 },
                user: { source: 'file', set: true, value: 'demo' },
                keyPath: { source: 'file', set: true, value: './secrets/nas_key' },
              },
            },
            qbittorrent: {
              configured: true,
              mock: false,
              fields: {
                url: { source: 'file', set: true, value: 'http://192.0.2.10:8080' },
                username: { source: 'file', set: true, value: 'demo' },
                password: { source: 'file', set: true },
              },
            },
            moviepilot: {
              configured: false,
              mock: false,
              fields: {
                url: { source: 'unset', set: false },
                apiToken: { source: 'unset', set: false },
              },
            },
          },
        });
      }

      if (url.endsWith('/api/integrations/qbittorrent') && method === 'PUT') {
        putBodies.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        return jsonResponse({ fileConfigured: true, modules: {} });
      }

      if (url.endsWith('/api/integrations/moviepilot/test') && method === 'POST') {
        testBodies.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        return jsonResponse({ ok: true, durationMs: 42, detail: 'MoviePilot API 连接成功' });
      }

      return jsonResponse({ error: '未预期请求' }, 404);
    });

    render(<SettingsPage />);

    expect(await screen.findByText('集成配置')).toBeInTheDocument();
    // NAS host 由 .env 管理，只读且带徽章
    const nasHostInput = screen.getByLabelText('主机地址') as HTMLInputElement;
    expect(nasHostInput).toBeDisabled();
    expect(nasHostInput.value).toBe('192.0.2.10');
    expect(screen.getByText('由 .env 管理')).toBeInTheDocument();

    // qBittorrent 密码只显示 placeholder "已设置（留空则不修改）"，不回显任何值
    const qbitPassInput = screen.getByLabelText('密码') as HTMLInputElement;
    expect(qbitPassInput.value).toBe('');
    expect(qbitPassInput.placeholder).toBe('已设置（留空则不修改）');

    // MoviePilot 令牌未设置
    const mpTokenInput = screen.getByLabelText('API 令牌') as HTMLInputElement;
    expect(mpTokenInput.placeholder).toBe('未设置');

    // 点击清除 qBittorrent 密码并保存，应发送 password: null
    await user.click(screen.getByRole('button', { name: '清除 qBittorrent 密码' }));
    expect(qbitPassInput.placeholder).toBe('已标记清除，保存后生效');

    const saveButtons = screen.getAllByRole('button', { name: '保存' });
    await user.click(saveButtons[1]!);
    expect(putBodies[0]?.body).toMatchObject({ password: null });

    // 测试连接 MoviePilot
    await user.type(screen.getByLabelText('服务地址'), 'https://mp.example.com');
    await user.type(mpTokenInput, 'fake-temp-token');
    const testButtons = screen.getAllByRole('button', { name: '测试连接' });
    await user.click(testButtons[2]!);

    expect(await screen.findByText(/MoviePilot API 连接成功/)).toBeInTheDocument();
    expect(testBodies[0]?.body).toEqual({
      url: 'https://mp.example.com',
      apiToken: 'fake-temp-token',
    });
  });
});
