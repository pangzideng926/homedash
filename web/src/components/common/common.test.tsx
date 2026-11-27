import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Server } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  CardGrid,
  DataCard,
  EmptyState,
  ErrorState,
  ExpiryCountdown,
  isValidIpInput,
  LoadingState,
  MaskedIp,
  maskIpAddress,
  ProgressBar,
  SectionCard,
  StatusBadge,
} from '@/components/common';

describe('公共组件库 common', () => {
  it('StatusBadge 支持 online/offline/warning/danger 与传统变体', () => {
    render(
      <div>
        <StatusBadge status="online" />
        <StatusBadge status="offline" />
        <StatusBadge status="warning" />
        <StatusBadge status="danger" />
        <StatusBadge status="success" label="正常运行" />
        <StatusBadge status="muted" label="停用" size="sm" />
      </div>,
    );

    expect(screen.getByText('在线').parentElement?.className).toContain('text-emerald-');
    expect(screen.getByText('离线').parentElement?.className).toContain('text-red-');
    expect(screen.getByText('警告').parentElement?.className).toContain('text-amber-');
    expect(screen.getByText('危险').parentElement?.className).toContain('text-red-');
    expect(screen.getByText('正常运行').parentElement?.className).toContain('text-emerald-');
    expect(screen.getByText('停用').parentElement?.className).toContain('text-[11px]');
  });

  it('ProgressBar 按占用率切换颜色与 data-level', () => {
    render(
      <div>
        <ProgressBar ariaLabel="CPU" label="CPU" showPercent value={40} />
        <ProgressBar ariaLabel="内存" label="内存" showPercent value={80} />
        <ProgressBar ariaLabel="磁盘" label="磁盘" showPercent value={95} />
        <ProgressBar ariaLabel="任务" tone="info" size="sm" value={60} />
      </div>,
    );

    expect(screen.getByRole('progressbar', { name: 'CPU' })).toHaveAttribute(
      'data-level',
      'normal',
    );
    expect(screen.getByRole('progressbar', { name: '内存' })).toHaveAttribute(
      'data-level',
      'warning',
    );
    expect(screen.getByRole('progressbar', { name: '磁盘' })).toHaveAttribute(
      'data-level',
      'danger',
    );
    expect(screen.getByRole('progressbar', { name: '任务' })).toHaveAttribute(
      'aria-valuenow',
      '60',
    );
  });

  it('ExpiryCountdown 渲染到期倒计时数字与等级颜色', () => {
    render(
      <div>
        <ExpiryCountdown daysLeft={-2} level="expired" expiresAt="2026-11-25" />
        <ExpiryCountdown daysLeft={0} level="danger" expiresAt="2026-11-27" />
        <ExpiryCountdown daysLeft={15} level="warning" expiresAt="2026-12-12" />
        <ExpiryCountdown daysLeft={120} level="ok" expiresAt="2027-03-27" />
        <ExpiryCountdown daysLeft={null} level={null} expiresAt="bad-date" error="日期无效" />
      </div>,
    );

    expect(screen.getByText('已过期 2 天').parentElement?.className).toContain('text-red-');
    expect(screen.getByText('今天到期').parentElement?.className).toContain('text-red-');
    expect(screen.getByText('剩余 15 天').parentElement?.className).toContain('text-amber-');
    expect(screen.getByText('剩余 120 天').parentElement?.className).toContain('text-emerald-');
    expect(screen.getByText('日期无效')).toBeInTheDocument();
  });

  it('MaskedIp 默认打码，点击切换明文且按钮包含 aria-label', async () => {
    const user = userEvent.setup();
    expect(maskIpAddress('192.0.2.10')).toBe('192.•••.•••.10');
    expect(maskIpAddress('2001:db8::42')).toBe('2001:••••:42');
    expect(isValidIpInput('192.0.2.10')).toBe(true);
    expect(isValidIpInput('999.0.0.1')).toBe(false);

    render(<MaskedIp ip="192.0.2.10" />);

    expect(screen.getByText('192.•••.•••.10')).toBeInTheDocument();
    expect(screen.queryByText('192.0.2.10')).not.toBeInTheDocument();

    const showBtn = screen.getByRole('button', { name: '显示 IP' });
    expect(showBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(showBtn);

    expect(screen.getByText('192.0.2.10')).toBeInTheDocument();
    const hideBtn = screen.getByRole('button', { name: '隐藏 IP' });
    expect(hideBtn).toHaveAttribute('aria-pressed', 'true');
    await user.click(hideBtn);

    expect(screen.getByText('192.•••.•••.10')).toBeInTheDocument();
  });

  it('SectionCard 支持标题、右侧操作与折叠详情', async () => {
    const user = userEvent.setup();
    render(
      <CardGrid columns={2}>
        <SectionCard
          icon={Server}
          title="测试节点"
          subtitle="副标题"
          actions={<button type="button">操作</button>}
          details={<p>隐藏的详细说明</p>}
        >
          <p>主体内容</p>
        </SectionCard>
      </CardGrid>,
    );

    expect(screen.getByRole('heading', { level: 3, name: '测试节点' })).toBeInTheDocument();
    expect(screen.getByText('副标题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作' })).toBeInTheDocument();
    expect(screen.queryByText('隐藏的详细说明')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByText('隐藏的详细说明')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收起详情' }));
    expect(screen.queryByText('隐藏的详细说明')).not.toBeInTheDocument();
  });

  it('DataCard、EmptyState、LoadingState、ErrorState 支持 compact 与重试', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <div>
        <DataCard compact title="在线数" value={3} status="online" footer="全部正常" />
        <EmptyState compact title="暂无数据" description="空状态说明" />
        <LoadingState variant="skeleton" rows={2} columns={2} compact message="骨架加载" />
        <ErrorState compact title="出错了" message="网络超时" onRetry={onRetry} />
      </div>,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('全部正常')).toBeInTheDocument();
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '骨架加载' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('网络超时');

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
