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

const LONG_NOTE_TEXT =
  '这是一段非常长的服务器备注信息，用来测试卡片上的备注折叠与详情展开交互是否正常工作，避免卡片过长影响扫读体验。';

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
      name: '香港',
      region: '香港',
      ip: '192.0.2.10',
      monthlyTrafficGB: 1000,
      role: '主面板/主线路',
      provider: 'Cloud A',
      expiresAt: '2026-11-24',
      price: 29,
      currency: 'CNY',
      renewUrl: 'https://billing.example.com/v1',
      note: '短备注测试',
      daysLeft: -3,
      level: 'expired',
    },
    {
      id: 'v2',
      name: '东京节点',
      region: '日本',
      ip: '192.0.2.20',
      monthlyTrafficGB: 2000,
      role: '转发出口',
      provider: 'Cloud B',
      expiresAt: '2026-12-01',
      price: 5.5,
      currency: 'USD',
      renewUrl: null,
      note: LONG_NOTE_TEXT,
      daysLeft: 4,
      level: 'danger',
    },
    {
      id: 'v3',
      name: '新加坡主线路',
      region: '新加坡',
      ip: null,
      monthlyTrafficGB: null,
      role: null,
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
      name: '德州备用机',
      region: '德州',
      ip: '2001:db8::42',
      monthlyTrafficGB: 500,
      role: '备份节点',
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

describe('VpsPage VPS 卡片页', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('以卡片网格渲染标题去重、倒计时数字、等级徽章、标签与接口顺序', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_VPS_RESPONSE));

    render(<VpsPage />);

    const expiredBadge = (await screen.findByText('已过期 3 天')).parentElement;
    const dangerBadge = screen.getByText('剩余 4 天').parentElement;
    const warningBadge = screen.getByText('剩余 20 天').parentElement;
    const okBadge = screen.getByText('剩余 186 天').parentElement;

    // 不再使用表格主列表
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    // 标题去重与组合：相等去重、包含去重、不同拼接
    const headings = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent);
    expect(headings).toEqual([
      '服务器总数',
      '已过期',
      '7 天内到期',
      '30 天内到期',
      '香港',
      '日本 · 东京节点',
      '新加坡主线路',
      '德州备用机',
    ]);
    expect(screen.queryByText('香港 · 香港')).not.toBeInTheDocument();
    expect(screen.queryByText('新加坡 · 新加坡主线路')).not.toBeInTheDocument();

    // 等级颜色语义
    expect(expiredBadge?.className).toContain('text-red-');
    expect(dangerBadge?.className).toContain('text-red-');
    expect(warningBadge?.className).toContain('text-amber-');
    expect(okBadge?.className).toContain('text-emerald-');

    // 醒目倒计时数字与元数据标签
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('186')).toBeInTheDocument();
    expect(screen.getByText('1000 GB')).toBeInTheDocument();
    expect(screen.getByText('29 CNY')).toBeInTheDocument();
    expect(screen.getByText('主面板/主线路')).toBeInTheDocument();
    expect(screen.getByText('2000 GB')).toBeInTheDocument();
    expect(screen.getByText('5.5 USD')).toBeInTheDocument();
    expect(screen.getByText('转发出口')).toBeInTheDocument();

    const renewLink = screen.getByRole('link', { name: '前往续费' });
    expect(renewLink).toHaveAttribute('href', 'https://billing.example.com/v1');
    expect(renewLink).toHaveAttribute('target', '_blank');
  });

  it('IP 默认打码显示，点击后切换明文与重新打码', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_VPS_RESPONSE));

    render(<VpsPage />);
    await screen.findByText('香港');

    // 默认打码，不直接暴露完整 IP
    expect(screen.getByText('192.•••.•••.10')).toBeInTheDocument();
    expect(screen.getByText('192.•••.•••.20')).toBeInTheDocument();
    expect(screen.getByText('2001:••••:42')).toBeInTheDocument();
    expect(screen.queryByText('192.0.2.10')).not.toBeInTheDocument();

    const showButtons = screen.getAllByRole('button', { name: '显示 IP' });
    // v1, v2, v4 有 IP，v3 无 IP -> 共 3 个显示 IP 按钮
    expect(showButtons).toHaveLength(3);

    await user.click(showButtons[0]!);
    expect(screen.getByText('192.0.2.10')).toBeInTheDocument();
    expect(screen.queryByText('192.•••.•••.10')).not.toBeInTheDocument();

    const hideButton = screen.getByRole('button', { name: '隐藏 IP' });
    await user.click(hideButton);
    expect(screen.getByText('192.•••.•••.10')).toBeInTheDocument();
    expect(screen.queryByText('192.0.2.10')).not.toBeInTheDocument();
  });

  it('短备注直接展示，长备注默认折叠并通过「详情」展开与收起', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_VPS_RESPONSE));

    render(<VpsPage />);
    await screen.findByText('短备注测试');

    expect(screen.queryByText(LONG_NOTE_TEXT)).not.toBeInTheDocument();
    const detailBtn = screen.getByRole('button', { name: '详情' });
    expect(detailBtn).toHaveAttribute('aria-expanded', 'false');

    await user.click(detailBtn);
    expect(screen.getByText(LONG_NOTE_TEXT)).toBeInTheDocument();
    const collapseBtn = screen.getByRole('button', { name: '收起详情' });
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');

    await user.click(collapseBtn);
    expect(screen.queryByText(LONG_NOTE_TEXT)).not.toBeInTheDocument();
  });

  it('支持表单校验、新增保存新字段与删除保存', async () => {
    const user = userEvent.setup({ delay: null });
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
              name: '洛杉矶线路',
              region: '洛杉矶',
              ip: '192.0.2.55',
              monthlyTrafficGB: 1500,
              role: '落地机',
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
    await screen.findByText('香港');

    await user.click(screen.getByRole('button', { name: '新增 VPS' }));

    // 空表单触发中文校验
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入服务器名称');

    await user.type(screen.getByLabelText('名称 *'), '洛杉矶线路');
    await user.type(screen.getByLabelText('到期日期（YYYY-MM-DD） *'), '2026-02-30');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('到期日期格式错误，应为 YYYY-MM-DD');

    await user.clear(screen.getByLabelText('到期日期（YYYY-MM-DD） *'));
    await user.type(screen.getByLabelText('到期日期（YYYY-MM-DD） *'), '2027-05-01');
    await user.type(screen.getByLabelText('IP 地址'), '999.0.0.1');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('IP 地址格式错误');

    await user.clear(screen.getByLabelText('IP 地址'));
    await user.type(screen.getByLabelText('地区'), '洛杉矶');
    await user.type(screen.getByLabelText('IP 地址'), '192.0.2.55');
    await user.type(screen.getByLabelText('月流量（GB）'), '1500');
    await user.type(screen.getByLabelText('用途'), '落地机');
    await user.type(screen.getByLabelText('服务商'), 'Example Host');
    await user.type(screen.getByLabelText('价格'), '88');
    await user.type(screen.getByLabelText('续费链接'), 'https://billing.example.com/v5');
    await user.type(screen.getByLabelText('备注'), '年付');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('洛杉矶线路')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/vps');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');

    const sentPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      servers: Array<Record<string, unknown>>;
    };
    expect(sentPayload.servers[0]).toMatchObject({
      id: 'v1',
      region: '香港',
      ip: '192.0.2.10',
      monthlyTrafficGB: 1000,
      role: '主面板/主线路',
    });
    expect(sentPayload.servers[4]).toMatchObject({
      name: '洛杉矶线路',
      region: '洛杉矶',
      ip: '192.0.2.55',
      monthlyTrafficGB: 1500,
      role: '落地机',
    });

    // 删除新增节点
    await user.click(screen.getByRole('button', { name: '删除 洛杉矶线路' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PUT');
  }, 15_000);

  it('只读模式下隐藏新增、编辑与删除按钮，但仍可查看打码 IP', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        ...SAMPLE_VPS_RESPONSE,
        readonly: true,
      }),
    );

    render(<VpsPage />);

    await screen.findByText('香港');
    expect(screen.getByText('只读模式')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增 VPS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();

    const showButtons = screen.getAllByRole('button', { name: '显示 IP' });
    await user.click(showButtons[0]!);
    expect(screen.getByText('192.0.2.10')).toBeInTheDocument();
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
