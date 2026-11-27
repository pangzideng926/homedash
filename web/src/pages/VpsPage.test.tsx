import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VpsPage } from '@/pages/VpsPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SAMPLE_VPS_RESPONSE = {
  configured: true,
  readonly: false,
  timezone: 'Asia/Shanghai',
  summary: {
    total: 4,
    expired: 1,
    within7Days: 1,
    within30Days: 2,
    invalid: 0,
  },
  servers: [
    {
      id: 'v1',
      name: '节点一（已过期）',
      provider: 'Cloud A',
      expiresAt: '2026-11-24',
      price: 29,
      currency: 'CNY',
      renewUrl: 'https://billing.example.com/v1',
      note: '测试过期节点',
      daysLeft: -3,
      level: 'expired',
    },
    {
      id: 'v2',
      name: '节点二（7天内）',
      provider: 'Cloud B',
      expiresAt: '2026-12-01',
      price: 5.5,
      currency: 'USD',
      renewUrl: null,
      note: null,
      daysLeft: 4,
      level: 'danger',
    },
    {
      id: 'v3',
      name: '节点三（30天内）',
      provider: 'Cloud C',
      expiresAt: '2026-12-17',
      price: null,
      currency: null,
      renewUrl: null,
      note: null,
      daysLeft: 20,
      level: 'warning',
    },
    {
      id: 'v4',
      name: '节点四（正常）',
      provider: 'Cloud D',
      expiresAt: '2027-06-01',
      price: 199,
      currency: 'CNY',
      renewUrl: null,
      note: null,
      daysLeft: 186,
      level: 'ok',
    },
  ],
};

describe('VpsPage VPS 到期提醒页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按 level 渲染颜色徽章、已过期 N 天、价格币种与新窗口续费链接', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_VPS_RESPONSE));

    render(<VpsPage />);

    const expiredBadge = (await screen.findByText('已过期 3 天')).parentElement;
    const dangerBadge = screen.getByText('剩余 4 天').parentElement;
    const warningBadge = screen.getByText('剩余 20 天').parentElement;
    const okBadge = screen.getByText('剩余 186 天').parentElement;

    expect(expiredBadge?.className).toContain('text-red-');
    expect(dangerBadge?.className).toContain('text-red-');
    expect(warningBadge?.className).toContain('text-amber-');
    expect(okBadge?.className).toContain('text-emerald-');

    expect(screen.getByText('29 CNY')).toBeInTheDocument();
    expect(screen.getByText('5.5 USD')).toBeInTheDocument();
    const renewLink = screen.getByRole('link', { name: '前往续费' });
    expect(renewLink).toHaveAttribute('href', 'https://billing.example.com/v1');
    expect(renewLink).toHaveAttribute('target', '_blank');
  });

  it('支持表单校验、新增保存与删除保存', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(SAMPLE_VPS_RESPONSE))
      .mockResolvedValueOnce(
        jsonResponse({
          ...SAMPLE_VPS_RESPONSE,
          summary: { ...SAMPLE_VPS_RESPONSE.summary, total: 5 },
          servers: [
            ...SAMPLE_VPS_RESPONSE.servers,
            {
              id: 'v5',
              name: '新增节点',
              provider: 'Example Host',
              expiresAt: '2027-05-01',
              price: 88,
              currency: 'CNY',
              renewUrl: 'https://billing.example.com/v5',
              note: '年付',
              daysLeft: 155,
              level: 'ok',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...SAMPLE_VPS_RESPONSE,
          summary: { ...SAMPLE_VPS_RESPONSE.summary, total: 4 },
        }),
      );

    render(<VpsPage />);
    await screen.findByText('节点一（已过期）');

    await user.click(screen.getByRole('button', { name: '新增 VPS' }));

    // 空表单触发中文校验
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入服务器名称');

    await user.type(screen.getByLabelText('名称 *'), '新增节点');
    await user.type(screen.getByLabelText('到期日期（YYYY-MM-DD） *'), '2026-02-30');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('到期日期格式错误，应为 YYYY-MM-DD');

    await user.clear(screen.getByLabelText('到期日期（YYYY-MM-DD） *'));
    await user.type(screen.getByLabelText('到期日期（YYYY-MM-DD） *'), '2027-05-01');
    await user.type(screen.getByLabelText('服务商'), 'Example Host');
    await user.type(screen.getByLabelText('价格'), '88');
    await user.type(screen.getByLabelText('续费链接'), 'https://billing.example.com/v5');
    await user.type(screen.getByLabelText('备注'), '年付');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('新增节点')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/vps');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');

    // 删除新增节点
    await user.click(screen.getByRole('button', { name: '删除 新增节点' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PUT');
  });

  it('只读模式下隐藏新增、编辑与删除按钮', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        ...SAMPLE_VPS_RESPONSE,
        readonly: true,
      }),
    );

    render(<VpsPage />);

    await screen.findByText('节点一（已过期）');
    expect(screen.getByText('只读模式')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增 VPS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });

  it('未配置时展示 EmptyState，文件错误时展示 ErrorState', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        configured: false,
        readonly: false,
        timezone: 'Asia/Shanghai',
        servers: [],
        summary: { total: 0, expired: 0, within7Days: 0, within30Days: 0, invalid: 0 },
        errorCode: 'UNCONFIGURED',
        error: '尚未配置 VPS 清单文件（VPS_LIST_FILE）',
      }),
    );

    const { unmount } = render(<VpsPage />);
    expect(await screen.findByText('尚未配置 VPS 清单')).toBeInTheDocument();
    unmount();

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        configured: true,
        readonly: false,
        timezone: 'Asia/Shanghai',
        servers: [],
        summary: { total: 0, expired: 0, within7Days: 0, within30Days: 0, invalid: 0 },
        errorCode: 'INVALID_JSON',
        error: 'VPS 清单文件 JSON 解析失败，请检查文件格式',
      }),
    );

    render(<VpsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('VPS 清单文件 JSON 解析失败');
  });
});
