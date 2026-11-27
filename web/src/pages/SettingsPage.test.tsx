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
          downloaders: {
            id: 'downloaders',
            label: '下载器',
            status: 'incomplete',
            statusLabel: '配置不完整',
            keys: {
              DOWNLOADERS_MOCK: false,
              DOWNLOADER_CACHE_SECONDS: true,
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
    expect(screen.getByText('DOWNLOADER_CACHE_SECONDS')).toBeInTheDocument();

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
      if (url.endsWith('/api/downloaders')) {
        return jsonResponse({ error: 'skip' }, 404);
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

  it('集成配置区支持 NAS/MoviePilot 保存测试与多实例下载器增删改及测试连接', async () => {
    const user = userEvent.setup();
    const putDownloaderBodies: Array<unknown> = [];
    const testDownloaderBodies: Array<unknown> = [];

    let currentDownloaders = [
      {
        id: 'qb-env',
        name: 'qBittorrent',
        type: 'qbittorrent',
        url: 'http://192.0.2.10:8080',
        username: 'demo',
        passwordSet: true,
        tags: [],
        enabled: true,
        source: 'env',
        readonly: true,
        readonlyReason: '由 .env 管理',
      },
      {
        id: 'tr-1',
        name: 'TR 保种',
        type: 'transmission',
        url: 'http://192.0.2.12:9091',
        username: 'demo',
        passwordSet: true,
        tags: ['seed'],
        enabled: true,
        source: 'file',
        readonly: false,
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.endsWith('/api/settings/status')) {
        return jsonResponse({ modules: {} });
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
                url: { source: 'env', set: true, value: 'http://192.0.2.10:8080' },
                username: { source: 'env', set: true, value: 'demo' },
                password: { source: 'env', set: true },
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

      if (url.endsWith('/api/downloaders') && method === 'GET') {
        return jsonResponse({
          configured: true,
          fileConfigured: true,
          mock: false,
          downloaders: currentDownloaders,
        });
      }

      if (url.endsWith('/api/downloaders') && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          downloaders: typeof currentDownloaders;
        };
        putDownloaderBodies.push(body);
        currentDownloaders = [
          currentDownloaders[0]!,
          ...body.downloaders.map((item, idx) => ({
            ...item,
            id: item.id ?? `new-${idx}`,
            passwordSet: true,
            source: 'file',
            readonly: false,
          })),
        ];
        return jsonResponse({
          configured: true,
          fileConfigured: true,
          mock: false,
          downloaders: currentDownloaders,
        });
      }

      if (url.endsWith('/api/downloaders/test') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        testDownloaderBodies.push(body);
        return jsonResponse({
          ok: true,
          type: 'transmission',
          version: '4.0.6',
          durationMs: 28,
          detail: 'Transmission 连接成功（版本：4.0.6）',
        });
      }

      return jsonResponse({ error: '未预期请求' }, 404);
    });

    render(<SettingsPage />);

    expect(await screen.findByText('集成配置')).toBeInTheDocument();
    // NAS host 由 .env 管理，只读且带徽章
    const nasHostInput = screen.getByLabelText('主机地址') as HTMLInputElement;
    expect(nasHostInput).toBeDisabled();
    expect(nasHostInput.value).toBe('192.0.2.10');
    expect(screen.getAllByText('由 .env 管理').length).toBeGreaterThanOrEqual(2);

    // 列表中显示 qBittorrent (env只读无编辑/删除) 与 TR 保种
    expect(screen.getByText('TR 保种')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑 qBittorrent' })).not.toBeInTheDocument();

    // 测试 TR 保种连接
    await user.click(screen.getByRole('button', { name: '测试连接 TR 保种' }));
    expect(await screen.findByText(/Transmission 连接成功/)).toBeInTheDocument();
    expect(testDownloaderBodies[0]).toMatchObject({ id: 'tr-1', type: 'transmission' });

    // 编辑 TR 保种，清除密码并保存
    await user.click(screen.getByRole('button', { name: '编辑 TR 保种' }));
    const dlPassInput = screen.getByLabelText('密码') as HTMLInputElement;
    expect(dlPassInput.placeholder).toBe('已设置（留空则不修改）');
    await user.click(screen.getByRole('button', { name: '清除下载器密码' }));
    expect(dlPassInput.placeholder).toBe('已标记清除，保存后生效');
    await user.click(screen.getByRole('button', { name: '保存实例' }));
    expect(putDownloaderBodies[0]).toMatchObject({
      downloaders: [{ id: 'tr-1', password: null }],
    });

    // 新增下载器实例并多选标签
    await user.click(screen.getByRole('button', { name: '新增下载器' }));
    await user.type(screen.getByLabelText('实例名称'), 'qB 刷流');
    await user.type(screen.getByLabelText('WebUI / RPC 地址'), 'http://192.0.2.11:8080');
    await user.type(screen.getByLabelText('用户名'), 'demo');
    await user.type(screen.getByLabelText('密码'), 'fake-pass-1');
    await user.click(screen.getByLabelText('刷流'));
    await user.click(screen.getByRole('button', { name: '保存实例' }));
    expect(putDownloaderBodies[1]).toMatchObject({
      downloaders: expect.arrayContaining([
        expect.objectContaining({
          name: 'qB 刷流',
          type: 'qbittorrent',
          tags: ['brush'],
          password: 'fake-pass-1',
        }),
      ]),
    });

    // 删除实例
    await user.click(screen.getByRole('button', { name: '删除 TR 保种' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(putDownloaderBodies).toHaveLength(3);
  });
});
