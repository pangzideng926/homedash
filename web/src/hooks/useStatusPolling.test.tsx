import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStatusPolling } from '@/hooks/useStatusPolling';
import {
  STATUS_REFRESH_STORAGE_KEY,
  STATUS_REFRESH_SYNC_STORAGE_KEY,
  formatLastUpdated,
  formatRelativeTimeSince,
  parseStatusRefreshInterval,
  readStatusRefreshInterval,
  writeStatusRefreshInterval,
} from '@/lib/status-refresh';

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    writable: true,
    value: state,
  });
}

describe('status-refresh 工具函数', () => {
  it('formatRelativeTimeSince 与 formatLastUpdated 正确格式化相对时间', () => {
    const base = Date.parse('2026-11-27T10:00:00.000Z');
    expect(formatRelativeTimeSince(null, base)).toBe('尚未更新');
    expect(formatLastUpdated(undefined, base)).toBe('尚未更新');
    expect(formatRelativeTimeSince('bad-date', base)).toBe('尚未更新');

    expect(formatRelativeTimeSince(base - 20_000, base)).toBe('刚刚');
    expect(formatLastUpdated(base - 59_000, base)).toBe('上次更新 刚刚');
    expect(formatLastUpdated(base - 60_000, base)).toBe('上次更新 1 分钟前');
    expect(formatLastUpdated(base - 5 * 60_000, base)).toBe('上次更新 5 分钟前');
    expect(formatLastUpdated(base - 2 * 3600_000, base)).toBe('上次更新 2 小时前');
    expect(formatLastUpdated(base - 3 * 86400_000, base)).toBe('上次更新 3 天前');
  });

  it('parseStatusRefreshInterval / read / write 默认 300 秒并支持合法值持久化', () => {
    expect(readStatusRefreshInterval()).toBe(300);
    expect(parseStatusRefreshInterval('60')).toBe(60);
    expect(parseStatusRefreshInterval('300')).toBe(300);
    expect(parseStatusRefreshInterval('900')).toBe(900);
    expect(parseStatusRefreshInterval('0')).toBe(0);
    expect(parseStatusRefreshInterval('15')).toBe(300);
    expect(parseStatusRefreshInterval('abc')).toBe(300);

    writeStatusRefreshInterval(60);
    expect(localStorage.getItem(STATUS_REFRESH_STORAGE_KEY)).toBe('60');
    expect(readStatusRefreshInterval()).toBe(60);

    writeStatusRefreshInterval(0);
    expect(localStorage.getItem(STATUS_REFRESH_STORAGE_KEY)).toBe('0');
    expect(readStatusRefreshInterval()).toBe(0);
  });
});

describe('useStatusPolling Hook', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setVisibilityState('visible');
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  });

  it('首次加载与定时轮询均使用非强制请求（refresh: false），并随时间推进更新相对时间', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T10:00:00.000Z'));
    writeStatusRefreshInterval(60);

    let count = 0;
    const fetcher = vi.fn(async ({ refresh }: { refresh: boolean; signal: AbortSignal }) => {
      count += 1;
      return {
        checkedAt: new Date(Date.now()).toISOString(),
        seq: count,
        refresh,
      };
    });

    const { result } = renderHook(() =>
      useStatusPolling({
        topic: 'devices',
        fetcher,
        getUpdatedAt: (d) => d.checkedAt,
        relativeTimeTickMs: 30_000,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, expect.objectContaining({ refresh: false }));
    expect(result.current.data?.seq).toBe(1);
    expect(formatLastUpdated(result.current.lastUpdatedAt, result.current.nowMs)).toBe(
      '上次更新 刚刚',
    );

    // 推进 60 秒：触发一次非强制轮询
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.objectContaining({ refresh: false }));
    expect(result.current.data?.seq).toBe(2);

    // 推进 60 秒再暂停 120 秒测试相对时间变化：手动 refresh() 传 refresh: true
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(3, expect.objectContaining({ refresh: true }));

    // 更改为关闭（0）后不再轮询
    act(() => {
      writeStatusRefreshInterval(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(formatLastUpdated(result.current.lastUpdatedAt, result.current.nowMs)).toBe(
      '上次更新 5 分钟前',
    );
  });

  it('页面不可见时暂停轮询，重新可见后恢复按间隔非强制轮询', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T10:00:00.000Z'));
    writeStatusRefreshInterval(60);

    const fetcher = vi.fn(async ({ refresh }: { refresh: boolean; signal: AbortSignal }) => ({
      checkedAt: new Date(Date.now()).toISOString(),
      refresh,
    }));

    renderHook(() =>
      useStatusPolling({
        topic: 'nas',
        fetcher,
        getUpdatedAt: (d) => d.checkedAt,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 切到后台
    act(() => {
      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 在不可见期间推进 180 秒（3 个周期）也不会触发请求
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 恢复可见：立即以 refresh: false 补一次并继续按 60 秒轮询
    await act(async () => {
      setVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.objectContaining({ refresh: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(3, expect.objectContaining({ refresh: false }));
  });

  it('BroadcastChannel 多标签页同步：标签 A 强制刷新后，标签 B 直接接收广播数据且不重复打 refresh=1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T10:00:00.000Z'));
    writeStatusRefreshInterval(300);

    const channels = new Set<MockBroadcastChannel>();
    class MockBroadcastChannel {
      name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(name: string) {
        this.name = name;
        channels.add(this);
      }
      postMessage(data: unknown) {
        for (const ch of channels) {
          if (ch !== this && ch.name === this.name && ch.onmessage) {
            ch.onmessage(new MessageEvent('message', { data }));
          }
        }
      }
      close() {
        channels.delete(this);
      }
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const fetcherA = vi.fn(async ({ refresh }: { refresh: boolean; signal: AbortSignal }) => ({
      checkedAt: new Date(Date.now()).toISOString(),
      source: refresh ? 'manual-A' : 'init-A',
    }));
    const fetcherB = vi.fn(async ({ refresh }: { refresh: boolean; signal: AbortSignal }) => ({
      checkedAt: new Date(Date.now()).toISOString(),
      source: refresh ? 'manual-B' : 'init-B',
    }));

    const hookA = renderHook(() =>
      useStatusPolling({ topic: 'devices', fetcher: fetcherA, getUpdatedAt: (d) => d.checkedAt }),
    );
    const hookB = renderHook(() =>
      useStatusPolling({ topic: 'devices', fetcher: fetcherB, getUpdatedAt: (d) => d.checkedAt }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);

    // 标签 A 手动强制刷新
    vi.setSystemTime(new Date('2026-11-27T10:01:00.000Z'));
    await act(async () => {
      await hookA.result.current.refresh();
    });

    expect(fetcherA).toHaveBeenCalledTimes(2);
    expect(fetcherA).toHaveBeenNthCalledWith(2, expect.objectContaining({ refresh: true }));
    // 标签 B 通过 BroadcastChannel 直接同步到标签 A 的结果，无需再发请求（更不会发 refresh: true）
    expect(fetcherB).toHaveBeenCalledTimes(1);
    expect(hookB.result.current.data?.source).toBe('manual-A');
  });

  it('无 BroadcastChannel 时通过 storage 事件兜底同步，且仅触发非强制请求（refresh: false）', async () => {
    vi.useFakeTimers();
    writeStatusRefreshInterval(300);

    const fetcher = vi.fn(async ({ refresh }: { refresh: boolean; signal: AbortSignal }) => ({
      checkedAt: '2026-11-27T10:01:00.000Z',
      refresh,
    }));

    renderHook(() => useStatusPolling({ topic: 'nas', fetcher, getUpdatedAt: (d) => d.checkedAt }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STATUS_REFRESH_SYNC_STORAGE_KEY,
          newValue: JSON.stringify({
            topic: 'nas',
            senderId: 'other-tab',
            eventId: 'evt-1',
            timestamp: Date.now(),
          }),
        }),
      );
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.objectContaining({ refresh: false }));
  });
});
