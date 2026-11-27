import { RotateCw } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import { fetchSettingsStatus } from '@/lib/api';

export function SettingsPage() {
  const { data, loading, error, refetch } = useApi(fetchSettingsStatus);

  const modules = data ? Object.values(data.modules) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="设置"
        description="查看系统与采集模块的配置状态（仅展示键是否已填写，不暴露任何敏感配置值）。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={loading}
          >
            <RotateCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
            <span>刷新</span>
          </Button>
        }
      />

      {loading ? (
        <LoadingState variant="skeleton" rows={6} message="正在加载配置状态..." />
      ) : error ? (
        <ErrorState
          title="获取配置状态失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : modules.length === 0 ? (
        <EmptyState title="暂无配置模块" description="当前未检测到可展示的配置模块。" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => (
            <Card key={mod.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                <CardTitle className="text-base">{mod.label}</CardTitle>
                <StatusBadge status={mod.status} label={mod.statusLabel} />
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {Object.entries(mod.keys).map(([key, filled]) => (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs"
                    >
                      <code className="truncate font-mono text-foreground">{key}</code>
                      <StatusBadge
                        status={filled ? 'success' : 'unconfigured'}
                        label={filled ? '已填' : '未填'}
                        showDot={false}
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
