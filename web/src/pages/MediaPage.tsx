import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Film, RotateCw } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import { formatDateTime } from '@/components/devices/device-utils';
import { MediaDownloadsTab } from '@/components/media/MediaDownloadsTab';
import { MediaOverviewTab } from '@/components/media/MediaOverviewTab';
import { MediaSubscriptionsTab } from '@/components/media/MediaSubscriptionsTab';
import { MediaWarningsBanner } from '@/components/media/MediaWarningsBanner';
import { Button } from '@/components/ui/button';
import { useApi } from '@/hooks/useApi';
import {
  fetchMediaDownloads,
  fetchMediaOverview,
  fetchMediaSubscriptions,
  type MediaDownloadsResponse,
  type MediaOverviewResponse,
  type MediaSubscriptionsResponse,
} from '@/lib/api';

type MediaTabId = 'overview' | 'downloads' | 'subscriptions';

type MediaTabPayload =
  | { tab: 'overview'; data: MediaOverviewResponse }
  | { tab: 'downloads'; data: MediaDownloadsResponse }
  | { tab: 'subscriptions'; data: MediaSubscriptionsResponse };

const MEDIA_TABS: ReadonlyArray<{ id: MediaTabId; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'downloads', label: '正在下载' },
  { id: 'subscriptions', label: '订阅追剧' },
];

function parseMediaTab(raw: string | null): MediaTabId {
  if (raw === 'downloads' || raw === 'subscriptions') return raw;
  return 'overview';
}

export function MediaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseMediaTab(searchParams.get('tab'));
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<MediaTabPayload> => {
      if (activeTab === 'overview') {
        return { tab: 'overview', data: await fetchMediaOverview({ signal }) };
      }
      if (activeTab === 'downloads') {
        return { tab: 'downloads', data: await fetchMediaDownloads({ signal }) };
      }
      return { tab: 'subscriptions', data: await fetchMediaSubscriptions({ signal }) };
    },
    [activeTab],
  );

  const { data: payload, loading, error, refetch } = useApi(fetcher, [activeTab]);
  const activePayload = payload && payload.tab === activeTab ? payload : null;
  const currentData = activePayload?.data ?? null;

  const handleSelectTab = (tabId: MediaTabId) => {
    if (tabId === 'overview') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: tabId }, { replace: true });
    }
  };

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      if (activeTab === 'overview') {
        await fetchMediaOverview({ refresh: true });
      } else if (activeTab === 'downloads') {
        await fetchMediaDownloads({ refresh: true });
      } else {
        await fetchMediaSubscriptions({ refresh: true });
      }
      await refetch();
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const isLoadingInitial = loading && !currentData;
  const isErrorInitial = Boolean(error) && !currentData;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="影视"
        description="影视总览、最近入库海报墙、正在下载与订阅追剧（只读，不含刷流实例）。"
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

      {/* 子页签导航 */}
      <div
        role="tablist"
        aria-label="影视功能页签"
        className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/50 p-1"
      >
        {MEDIA_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <Button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              size="sm"
              variant={selected ? 'default' : 'ghost'}
              onClick={() => handleSelectTab(tab.id)}
            >
              {tab.label}
            </Button>
          );
        })}
      </div>

      {isLoadingInitial ? (
        <LoadingState variant="skeleton" rows={6} message="正在加载影视数据..." />
      ) : isErrorInitial ? (
        <ErrorState
          title="获取影视数据失败"
          message={error?.message ?? '请求失败，请稍后重试'}
          onRetry={() => void refetch()}
        />
      ) : !currentData || !currentData.configured ? (
        <EmptyState
          title="尚未配置影视模块"
          description="请前往设置页填写 MoviePilot 服务地址与 API 令牌，或添加带「下载」/「保种」标签的下载器实例。"
          icon={Film}
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status="success" label="只读采集" />
            {currentData.mock ? (
              <StatusBadge status="info" label="模拟数据" showDot={false} />
            ) : null}
            {currentData.cached ? (
              <StatusBadge status="unknown" label="缓存命中" showDot={false} />
            ) : null}
            <span>最近更新：{formatDateTime(currentData.checkedAt)}</span>
          </div>

          <MediaWarningsBanner warnings={currentData.warnings} />

          {activePayload?.tab === 'overview' ? (
            <MediaOverviewTab data={activePayload.data} />
          ) : null}

          {activePayload?.tab === 'downloads' ? (
            <MediaDownloadsTab data={activePayload.data} />
          ) : null}

          {activePayload?.tab === 'subscriptions' ? (
            <MediaSubscriptionsTab data={activePayload.data} />
          ) : null}
        </div>
      )}
    </div>
  );
}

export default MediaPage;
