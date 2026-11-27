import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{`${location.pathname}${location.search}`}</div>;
}

const SAMPLE_SETTINGS_STATUS = {
  modules: {
    app: {
      id: 'app',
      label: '应用基础',
      status: 'configured',
      statusLabel: '已配置',
      keys: { PORT: true, HOST: true },
    },
    nas: {
      id: 'nas',
      label: 'NAS',
      status: 'unconfigured',
      statusLabel: '未配置',
      keys: { NAS_SSH_HOST: false },
    },
  },
};

describe('homedash 前端认证与控制台', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('登录页能渲染出中文标题和登录按钮', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: '未登录或会话已失效' }, 401),
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '登录控制台' })).toBeInTheDocument();
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('未登录访问受保护路由时跳转至 /login 并携带 redirect 参数', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: '未登录或会话已失效' }, 401),
    );

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
        <LocationDisplay />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '登录控制台' })).toBeInTheDocument();
    expect(screen.getByTestId('location-display')).toHaveTextContent('/login?redirect=%2Fsettings');
  });

  it('登录成功后自动回跳到 redirect 指定的受保护页面', async () => {
    const user = userEvent.setup();
    let loggedIn = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return loggedIn
          ? jsonResponse({
              username: 'admin',
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            })
          : jsonResponse({ error: '未登录或会话已失效' }, 401);
      }
      if (url.endsWith('/api/auth/login')) {
        loggedIn = true;
        return jsonResponse({ ok: true });
      }
      if (url.endsWith('/api/settings/status')) {
        return jsonResponse(SAMPLE_SETTINGS_STATUS);
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
        <LocationDisplay />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '登录' });
    await user.type(screen.getByLabelText('用户名'), 'admin');
    await user.type(screen.getByLabelText('密码'), 'test-pass-placeholder');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByTestId('location-display')).toHaveTextContent('/settings');
    expect(await screen.findByText('应用基础')).toBeInTheDocument();
  });

  it('已登录状态下请求受保护接口返回 401 时清空登录状态并跳回登录页提示过期', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse({
          username: 'admin',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      }
      if (url.endsWith('/api/settings/status')) {
        return jsonResponse({ error: '未登录或会话已失效' }, 401);
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
        <LocationDisplay />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '登录控制台' })).toBeInTheDocument();
    expect(screen.getByText('登录已过期，请重新登录')).toBeInTheDocument();
    expect(screen.getByTestId('location-display')).toHaveTextContent(
      '/login?redirect=%2Fsettings&reason=expired',
    );
  });

  it('/api/auth/me 返回已过期的 expiresAt 时跳转登录并提示登录已过期', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse({
          username: 'admin',
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        });
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
        <LocationDisplay />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '登录控制台' })).toBeInTheDocument();
    expect(screen.getByText('登录已过期，请重新登录')).toBeInTheDocument();
    expect(screen.getByTestId('location-display')).toHaveTextContent(
      '/login?redirect=%2F&reason=expired',
    );
  });

  it('登录返回 429 时显示后端返回的中文限流提示', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse({ error: '未登录或会话已失效' }, 401);
      }
      if (url.endsWith('/api/auth/login')) {
        return jsonResponse({ error: '登录失败次数过多，请在 15 分钟后重试' }, 429, {
          'Retry-After': '900',
        });
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '登录' });
    await user.type(screen.getByLabelText('用户名'), 'admin');
    await user.type(screen.getByLabelText('密码'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '登录失败次数过多，请在 15 分钟后重试',
    );
  });

  it('登录失败时显示“用户名或密码错误”提示', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse({ error: '未登录或会话已失效' }, 401);
      }
      if (url.endsWith('/api/auth/login')) {
        return jsonResponse({ error: '用户名或密码错误' }, 401);
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '登录' });
    await user.type(screen.getByLabelText('用户名'), 'admin');
    await user.type(screen.getByLabelText('密码'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误');
  });

  it('登录成功后进入控制台，展示总览卡片、占位页、404 页面并支持退出登录', async () => {
    const user = userEvent.setup();
    let loggedIn = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return loggedIn
          ? jsonResponse({
              username: 'admin',
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            })
          : jsonResponse({ error: '未登录或会话已失效' }, 401);
      }
      if (url.endsWith('/api/auth/login')) {
        loggedIn = true;
        return jsonResponse({ ok: true });
      }
      if (url.endsWith('/api/auth/logout')) {
        loggedIn = false;
        return jsonResponse({ ok: true });
      }
      if (url.endsWith('/api/vps')) {
        return jsonResponse({
          configured: true,
          readonly: false,
          timezone: 'Asia/Shanghai',
          summary: { total: 2, expired: 0, within7Days: 1, within30Days: 1, invalid: 0 },
          servers: [
            {
              id: 'demo-1',
              name: '香港节点',
              provider: 'Example Cloud',
              expiresAt: '2026-12-01',
              price: 39,
              currency: 'CNY',
              renewUrl: null,
              note: null,
              daysLeft: 4,
              level: 'danger',
            },
          ],
        });
      }
      if (url.startsWith('/api/devices/status')) {
        return jsonResponse({
          configured: true,
          source: 'mock',
          readonly: true,
          checkedAt: '2026-11-27T08:00:00.000Z',
          summary: { total: 2, online: 1, offline: 1 },
          devices: [
            {
              id: 'demo-win',
              name: '客厅主机',
              os: 'windows',
              online: true,
              checkedAt: '2026-11-27T08:00:00.000Z',
              cached: false,
              data: {
                hostname: 'DEMO-PC',
                os: 'windows',
                osVersion: 'Windows 11',
                bootTime: '2026-11-24T00:00:00.000Z',
                uptimeSeconds: 10000,
                cpu: { model: 'Demo CPU', cores: 8, loadPercent: 25 },
                memory: { totalBytes: 100, usedBytes: 50, usedPercent: 50 },
                disks: [],
              },
            },
            {
              id: 'demo-mac',
              name: '书房 Mac',
              os: 'macos',
              online: false,
              checkedAt: '2026-11-27T08:00:00.000Z',
              cached: false,
              error: '连接超时',
            },
          ],
        });
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '登录' });
    await user.type(screen.getByLabelText('用户名'), 'admin');
    await user.type(screen.getByLabelText('密码'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('NAS 状态')).toBeInTheDocument();
    expect(screen.getByText('做种概况')).toBeInTheDocument();
    expect(screen.getByText('家用设备', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('VPS 到期')).toBeInTheDocument();
    expect(screen.getByText('最近告警')).toBeInTheDocument();
    expect(await screen.findByText('1 / 2 在线')).toBeInTheDocument();
    expect(screen.getByText('客厅主机')).toBeInTheDocument();
    expect(screen.getByText('书房 Mac')).toBeInTheDocument();
    expect(screen.getByText(/CPU 25% · 内存 50%/)).toBeInTheDocument();
    expect(await screen.findByText('2 台')).toBeInTheDocument();
    expect(screen.getByText(/最近到期：香港节点/)).toBeInTheDocument();
    expect(screen.getAllByText('暂无数据')).toHaveLength(3);

    await user.click(screen.getByRole('link', { name: 'NAS' }));
    expect(await screen.findByText('即将上线')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '退出登录' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '登录控制台' })).toBeInTheDocument();
    });
  });

  it('已登录访问未知路径时渲染 404 页面', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse({
          username: 'admin',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '页面未找到' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
  });

  it('旧路由 /pc 自动重定向到 /devices', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse({
          username: 'admin',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      }
      if (url === '/api/devices') {
        return jsonResponse({
          configured: false,
          source: 'unconfigured',
          readonly: false,
          devices: [],
          errorCode: 'UNCONFIGURED',
          error: '尚未配置家用设备',
        });
      }
      if (url.startsWith('/api/devices/status')) {
        return jsonResponse({
          configured: false,
          source: 'unconfigured',
          readonly: false,
          checkedAt: '2026-11-27T08:00:00.000Z',
          devices: [],
          summary: { total: 0, online: 0, offline: 0 },
          errorCode: 'UNCONFIGURED',
          error: '尚未配置家用设备',
        });
      }
      return jsonResponse({ error: '接口不存在' }, 404);
    });

    render(
      <MemoryRouter initialEntries={['/pc']}>
        <AppRoutes />
        <LocationDisplay />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '家用设备' })).toBeInTheDocument();
    expect(screen.getByTestId('location-display')).toHaveTextContent('/devices');
  });
});
