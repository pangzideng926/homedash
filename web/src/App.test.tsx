import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

  it('未登录访问受保护页面时跳转至登录页', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: '未登录或会话已失效' }, 401),
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '登录控制台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
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
      return jsonResponse({ error: '未找到接口' }, 404);
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

  it('登录成功后进入控制台，展示侧栏、总览卡片、占位页并支持退出登录', async () => {
    const user = userEvent.setup();
    let loggedIn = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/auth/me')) {
        return loggedIn
          ? jsonResponse({ username: 'admin' }, 200)
          : jsonResponse({ error: '未登录或会话已失效' }, 401);
      }
      if (url.endsWith('/api/auth/login')) {
        loggedIn = true;
        return jsonResponse({ ok: true }, 200);
      }
      if (url.endsWith('/api/auth/logout')) {
        loggedIn = false;
        return jsonResponse({ ok: true }, 200);
      }
      return jsonResponse({ error: '未找到接口' }, 404);
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
    expect(screen.getByText('家用电脑', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('VPS 到期')).toBeInTheDocument();
    expect(screen.getByText('最近告警')).toBeInTheDocument();
    expect(screen.getAllByText('暂无数据')).toHaveLength(5);

    await user.click(screen.getByRole('link', { name: 'NAS' }));
    expect(await screen.findByText('即将上线')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '退出登录' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '登录控制台' })).toBeInTheDocument();
    });
  });
});
