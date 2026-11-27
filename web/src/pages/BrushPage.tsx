import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Flame, RotateCw } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/common';
import { DownloaderInstancesSection } from '@/components/downloaders/DownloaderInstancesSection';
import { computeFilteredTotals } from '@/components/downloaders/downloader-utils';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/useApi';
import { fetchDownloadersSummary } from '@/lib/api';

export function BrushPage() {
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useCallback((signal: AbortSignal) => fetchDownloadersSummary({ signal }), []);
  const { data, loading, error, refetch } = useApi(fetcher);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchDownloadersSummary({ refresh: true });
      await refetch();
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const brushInstances = useMemo(
    () => (data?.instances ?? []).filter((inst) => inst.tags.includes('brush')),
    [data],
  );
  const brushTotals = useMemo(() => computeFilteredTotals(brushInstances), [brushInstances]);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="刷流"
        description="仅展示带有「刷流」用途标签的下载器实例及活跃任务（不混入影视模块统计）。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleForceRefresh()}
            disabled={loading || refreshing}
          >
            <RotateCw
              className={loading || refreshing ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingState variant="skeleton" rows={6} message="正在加载刷流实例状态..." />
      ) : error && !data ? (
        <ErrorState
          title="获取刷流状态失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data || !data.configured ? (
        <EmptyState
          title="尚未配置下载器"
          description="请前往设置页添加下载器并勾选「刷流」用途标签。"
          icon={Flame}
          action={
            <Link
              to="/settings"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              前往设置
            </Link>
          }
        />
      ) : brushInstances.length === 0 ? (
        <EmptyState
          title="暂无刷流下载器实例"
          description="当前没有标记「刷流」标签的启用下载器，可在设置页为实例勾选「刷流」标签。"
          icon={Flame}
          action={
            <Link
              to="/settings"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              前往设置
            </Link>
          }
        />
      ) : (
        <DownloaderInstancesSection
          instances={brushInstances}
          totals={brushTotals}
          checkedAt={data.checkedAt}
          mock={data.mock}
        />
      )}
    </div>
  );
}

export default BrushPage;
