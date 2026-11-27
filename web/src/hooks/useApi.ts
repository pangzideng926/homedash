import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

/**
 * 轻量数据请求 Hook：管理加载态、错误态、重试与过期请求取消。
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  const fetcherRef = useRef(fetcher);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const execute = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const seq = ++requestSeqRef.current;

    try {
      const result = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted || seq !== requestSeqRef.current) {
        return;
      }
      setData(result);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (
        controller.signal.aborted ||
        seq !== requestSeqRef.current ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        return;
      }
      const normalized =
        err instanceof ApiError
          ? err
          : new ApiError(err instanceof Error ? err.message : '请求失败，请稍后重试', 0);
      setError(normalized);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    const seq = ++requestSeqRef.current;

    void fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted || seq !== requestSeqRef.current) {
          return;
        }
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (
          controller.signal.aborted ||
          seq !== requestSeqRef.current ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return;
        }
        const normalized =
          err instanceof ApiError
            ? err
            : new ApiError(err instanceof Error ? err.message : '请求失败，请稍后重试', 0);
        setError(normalized);
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    await execute();
  }, [execute]);

  return { data, loading, error, refetch };
}
