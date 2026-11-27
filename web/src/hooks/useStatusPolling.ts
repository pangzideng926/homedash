import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { ApiError } from '@/lib/api';
import {
  STATUS_REFRESH_BROADCAST_CHANNEL,
  STATUS_REFRESH_INTERVAL_EVENT,
  STATUS_REFRESH_STORAGE_KEY,
  STATUS_REFRESH_SYNC_STORAGE_KEY,
  broadcastStatusUpdate,
  createTabSenderId,
  parseStatusRefreshInterval,
  readStatusRefreshInterval,
  type StatusBroadcastMessage,
  type StatusRefreshIntervalSeconds,
  type StatusRefreshTopic,
  type StatusStorageSyncPayload,
} from '@/lib/status-refresh';

export interface UseStatusPollingOptions<T> {
  topic: StatusRefreshTopic;
  fetcher: (options: { refresh: boolean; signal: AbortSignal }) => Promise<T>;
  getUpdatedAt?: (data: T) => string | null | undefined;
  intervalSeconds?: StatusRefreshIntervalSeconds;
  enabled?: boolean;
  relativeTimeTickMs?: number;
}

export interface UseStatusPollingResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: ApiError | null;
  intervalSeconds: StatusRefreshIntervalSeconds;
  lastUpdatedAt: string | null;
  nowMs: number;
  senderId: string;
  refresh: () => Promise<T | null>;
  refetch: () => Promise<T | null>;
  setData: (value: SetStateAction<T | null>) => void;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * 可复用的状态轮询 Hook：
 * - 首次加载与定时轮询均使用非强制请求（refresh: false）以命中后端缓存
 * - 仅手动调用 refresh() 时传 refresh: true 并通过 BroadcastChannel / storage 通知其他标签页
 * - 页面不可见时暂停轮询与计时，恢复可见时按需续期
 */
export function useStatusPolling<T>({
  topic,
  fetcher,
  getUpdatedAt,
  intervalSeconds: intervalOverride,
  enabled = true,
  relativeTimeTickMs = 30_000,
}: UseStatusPollingOptions<T>): UseStatusPollingResult<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [storedInterval, setStoredInterval] =
    useState<StatusRefreshIntervalSeconds>(readStatusRefreshInterval);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const effectiveInterval = intervalOverride ?? storedInterval;

  const [senderId] = useState<string>(createTabSenderId);
  const fetcherRef = useRef(fetcher);
  const getUpdatedAtRef = useRef(getUpdatedAt);
  const dataRef = useRef<T | null>(null);
  const enabledRef = useRef<boolean>(enabled);
  const intervalRef = useRef<StatusRefreshIntervalSeconds>(effectiveInterval);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchAtRef = useRef<number>(0);
  const pendingSyncRef = useRef<boolean>(false);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    getUpdatedAtRef.current = getUpdatedAt;
  }, [getUpdatedAt]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    intervalRef.current = effectiveInterval;
  }, [effectiveInterval]);

  const setData = useCallback((value: SetStateAction<T | null>) => {
    setDataState((prev) => {
      const next =
        typeof value === 'function' ? (value as (prevState: T | null) => T | null)(prev) : value;
      dataRef.current = next;
      return next;
    });
  }, []);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const clearTickTimer = useCallback(() => {
    if (tickTimerRef.current !== null) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const executeFetchRef = useRef<
    (options: { refresh: boolean; background: boolean }) => Promise<T | null>
  >(async () => null);

  const scheduleNextPoll = useCallback(
    (delayOverrideMs?: number) => {
      clearPollTimer();
      const intervalSec = intervalRef.current;
      if (!mountedRef.current || !enabledRef.current || intervalSec <= 0 || isDocumentHidden()) {
        return;
      }

      const delayMs =
        delayOverrideMs !== undefined ? Math.max(0, delayOverrideMs) : intervalSec * 1000;
      pollTimerRef.current = setTimeout(() => {
        pollTimerRef.current = null;
        if (!mountedRef.current || !enabledRef.current || isDocumentHidden()) {
          return;
        }
        void executeFetchRef.current({
          refresh: false,
          background: dataRef.current !== null,
        });
      }, delayMs);
    },
    [clearPollTimer],
  );

  const applySuccessData = useCallback(
    (result: T, broadcast: boolean) => {
      const now = Date.now();
      const extracted = getUpdatedAtRef.current?.(result);
      const updatedIso =
        typeof extracted === 'string' && extracted.trim() ? extracted : new Date(now).toISOString();

      dataRef.current = result;
      setDataState(result);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      setLastUpdatedAt(updatedIso);
      lastFetchAtRef.current = now;
      setNowMs(now);

      if (broadcast) {
        const eventId = broadcastStatusUpdate({
          topic,
          senderId,
          payload: result,
        });
        seenEventsRef.current.add(eventId);
      }

      scheduleNextPoll();
    },
    [scheduleNextPoll, senderId, topic],
  );

  const executeFetch = useCallback(
    async ({
      refresh,
      background,
    }: {
      refresh: boolean;
      background: boolean;
    }): Promise<T | null> => {
      if (!enabledRef.current || !mountedRef.current) {
        return null;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const seq = ++requestSeqRef.current;
      clearPollTimer();

      try {
        const result = await fetcherRef.current({
          refresh,
          signal: controller.signal,
        });
        if (!mountedRef.current || controller.signal.aborted || seq !== requestSeqRef.current) {
          return null;
        }
        applySuccessData(result, refresh);
        return result;
      } catch (err) {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          seq !== requestSeqRef.current ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return null;
        }

        const normalized =
          err instanceof ApiError
            ? err
            : new ApiError(err instanceof Error ? err.message : '请求失败，请稍后重试', 0);

        setLoading(false);
        setRefreshing(false);
        if (!background || dataRef.current === null) {
          setError(normalized);
        }
        scheduleNextPoll();
        return null;
      }
    },
    [applySuccessData, clearPollTimer, scheduleNextPoll],
  );

  useEffect(() => {
    executeFetchRef.current = executeFetch;
  }, [executeFetch]);

  const startTickTimer = useCallback(() => {
    clearTickTimer();
    if (!mountedRef.current || isDocumentHidden() || relativeTimeTickMs <= 0) {
      return;
    }
    tickTimerRef.current = setInterval(() => {
      if (!isDocumentHidden()) {
        setNowMs(Date.now());
      }
    }, relativeTimeTickMs);
  }, [clearTickTimer, relativeTimeTickMs]);

  // 挂载/启用状态变更时执行首次非强制加载
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      clearPollTimer();
      return () => {
        mountedRef.current = false;
        clearPollTimer();
        clearTickTimer();
        abortControllerRef.current?.abort();
      };
    }

    void executeFetch({ refresh: false, background: false });
    startTickTimer();

    return () => {
      mountedRef.current = false;
      clearPollTimer();
      clearTickTimer();
      abortControllerRef.current?.abort();
    };
  }, [clearPollTimer, clearTickTimer, enabled, executeFetch, startTickTimer]);

  // 当刷新间隔变化时重排或暂停定时器
  useEffect(() => {
    if (!enabled) {
      clearPollTimer();
      return;
    }
    if (effectiveInterval <= 0) {
      clearPollTimer();
      return;
    }
    if (lastFetchAtRef.current > 0) {
      const elapsed = Date.now() - lastFetchAtRef.current;
      const remaining = effectiveInterval * 1000 - elapsed;
      if (remaining <= 0 && !isDocumentHidden()) {
        void executeFetch({ refresh: false, background: dataRef.current !== null });
      } else {
        scheduleNextPoll(remaining);
      }
    }
  }, [clearPollTimer, effectiveInterval, enabled, executeFetch, scheduleNextPoll]);

  // 页面可见性变化：不可见暂停，恢复可见按需拉取/续期
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (isDocumentHidden()) {
        clearPollTimer();
        clearTickTimer();
        return;
      }

      const now = Date.now();
      setNowMs(now);
      startTickTimer();

      if (!enabledRef.current) {
        return;
      }

      if (pendingSyncRef.current) {
        pendingSyncRef.current = false;
        void executeFetch({ refresh: false, background: dataRef.current !== null });
        return;
      }

      const intervalSec = intervalRef.current;
      if (intervalSec <= 0) {
        return;
      }

      const elapsed =
        lastFetchAtRef.current > 0 ? now - lastFetchAtRef.current : intervalSec * 1000;
      const remaining = intervalSec * 1000 - elapsed;
      if (remaining <= 0) {
        void executeFetch({ refresh: false, background: dataRef.current !== null });
      } else {
        scheduleNextPoll(remaining);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearPollTimer, clearTickTimer, executeFetch, scheduleNextPoll, startTickTimer]);

  // 跨标签页与同标签页同步（BroadcastChannel + CustomEvent + storage 兜底）
  useEffect(() => {
    const markEventSeen = (eventId: string): boolean => {
      if (seenEventsRef.current.has(eventId)) {
        return false;
      }
      seenEventsRef.current.add(eventId);
      if (seenEventsRef.current.size > 50) {
        const first = seenEventsRef.current.values().next().value;
        if (first) seenEventsRef.current.delete(first);
      }
      return true;
    };

    const handleRemoteStatusUpdated = (params: {
      topic: StatusRefreshTopic;
      senderId: string;
      eventId: string;
      payload?: unknown;
    }) => {
      if (params.topic !== topic || params.senderId === senderId) {
        return;
      }
      if (!markEventSeen(params.eventId)) {
        return;
      }

      if (params.payload !== undefined) {
        applySuccessData(params.payload as T, false);
        return;
      }

      if (!enabledRef.current) {
        return;
      }

      if (isDocumentHidden()) {
        pendingSyncRef.current = true;
        return;
      }

      // 另一标签页刚刷新完（无直接 payload），本标签页走非强制请求命中服务端缓存
      void executeFetch({ refresh: false, background: dataRef.current !== null });
    };

    const handleCustomIntervalEvent = (event: Event) => {
      const custom = event as CustomEvent<StatusRefreshIntervalSeconds>;
      setStoredInterval(parseStatusRefreshInterval(custom.detail));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STATUS_REFRESH_STORAGE_KEY) {
        setStoredInterval(parseStatusRefreshInterval(event.newValue));
        return;
      }
      if (event.key === STATUS_REFRESH_SYNC_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue) as Partial<StatusStorageSyncPayload>;
          if (
            (parsed.topic === 'devices' || parsed.topic === 'nas') &&
            typeof parsed.senderId === 'string' &&
            typeof parsed.eventId === 'string'
          ) {
            handleRemoteStatusUpdated({
              topic: parsed.topic,
              senderId: parsed.senderId,
              eventId: parsed.eventId,
            });
          }
        } catch {
          // 忽略无效同步消息
        }
      }
    };

    window.addEventListener(STATUS_REFRESH_INTERVAL_EVENT, handleCustomIntervalEvent);
    window.addEventListener('storage', handleStorage);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel(STATUS_REFRESH_BROADCAST_CHANNEL);
        channel.onmessage = (event: MessageEvent<StatusBroadcastMessage>) => {
          const msg = event.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'interval-changed') {
            setStoredInterval(parseStatusRefreshInterval(msg.intervalSeconds));
            return;
          }
          if (msg.type === 'status-updated') {
            handleRemoteStatusUpdated({
              topic: msg.topic,
              senderId: msg.senderId,
              eventId: msg.eventId,
              payload: msg.payload,
            });
          }
        };
      } catch {
        channel = null;
      }
    }

    return () => {
      window.removeEventListener(STATUS_REFRESH_INTERVAL_EVENT, handleCustomIntervalEvent);
      window.removeEventListener('storage', handleStorage);
      channel?.close();
    };
  }, [applySuccessData, executeFetch, senderId, topic]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    return executeFetch({ refresh: true, background: dataRef.current !== null });
  }, [executeFetch]);

  const refetch = useCallback(async () => {
    if (dataRef.current === null) {
      setLoading(true);
    }
    setError(null);
    return executeFetch({ refresh: false, background: false });
  }, [executeFetch]);

  return {
    data,
    loading: enabled ? loading : false,
    refreshing,
    error,
    intervalSeconds: effectiveInterval,
    lastUpdatedAt,
    nowMs,
    senderId,
    refresh,
    refetch,
    setData,
  };
}
