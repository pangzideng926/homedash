import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpDown, RotateCw } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/common';
import { DownloaderInstancesSection } from '@/components/downloaders/DownloaderInstancesSection';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/useApi';
import { fetchDownloadersSummary } from '@/lib/api';

export function SeedingPage() {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="下载器"
        description="多实例下载器（qBittorrent / Transmission）只读传输速度、做种统计与异常排查。"
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
        <LoadingState variant="skeleton" rows={6} message="正在加载下载器状态..." />
      ) : error && !data ? (
        <ErrorState
          title="获取下载器状态失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data || !data.configured ? (
        <EmptyState
          title="尚未配置下载器"
          description="请前往设置页添加 qBittorrent 或 Transmission 下载器实例，或在环境变量中启用 DOWNLOADERS_MOCK=true。"
          icon={ArrowUpDown}
          action={
            <Link
              to="/settings"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              前往设置
            </Link>
          }
        />
      ) : data.instances.length === 0 ? (
        <EmptyState
          title="暂无启用的下载器实例"
          description="当前所有下载器实例均已停用，请前往设置页启用至少一个实例。"
          icon={ArrowUpDown}
          action={
            <Link
              to="/settings"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              管理下载器
            </Link>
          }
        />
      ) : (
        <DownloaderInstancesSection
          instances={data.instances}
          totals={data.totals}
          checkedAt={data.checkedAt}
          mock={data.mock}
        />
      )}
    </div>
  );
}

export default SeedingPage;
