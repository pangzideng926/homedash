import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Container,
  Cpu,
  FileText,
  HardDrive,
  Info,
  MemoryStick,
  Play,
  RotateCw,
  Server,
  Shield,
  Square,
  Thermometer,
  X,
  XCircle,
} from 'lucide-react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  type StatusVariant,
} from '@/components/common';
import { formatBytes, formatDateTime, formatUptime } from '@/components/devices/device-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/useApi';
import {
  executeNasDockerAction,
  fetchNasDockerAudit,
  fetchNasDockerLogs,
  fetchNasStatus,
  type DockerAction,
  type DockerAuditEntry,
  type NasDockerContainer,
} from '@/lib/api';
import { cn } from '@/lib/utils';

function getTempVariant(tempC: number): 'error' | 'warning' | 'success' {
  if (tempC >= 85) return 'error';
  if (tempC >= 70) return 'warning';
  return 'success';
}

function getVolumeLevel(percent: number): 'danger' | 'warning' | 'normal' {
  if (percent >= 90) return 'danger';
  if (percent >= 80) return 'warning';
  return 'normal';
}

function getBarClassByThreshold(percent: number, warnAt: number, dangerAt: number): string {
  if (percent >= dangerAt) return 'bg-red-500';
  if (percent >= warnAt) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function getContainerStatusBadge(container: NasDockerContainer): {
  status: StatusVariant;
  label: string;
  stopped: boolean;
} {
  const state = container.state.toLowerCase();
  if (state === 'running') {
    return { status: 'success', label: '运行', stopped: false };
  }
  if (state === 'restarting') {
    return { status: 'warning', label: '重启中', stopped: false };
  }
  if (state === 'exited' || state === 'created' || state === 'dead') {
    return { status: 'unknown', label: '已停止', stopped: true };
  }
  return { status: 'error', label: '异常', stopped: false };
}

function getAuditResultBadge(result: DockerAuditEntry['result']): {
  status: StatusVariant;
  label: string;
} {
  if (result === 'success') return { status: 'success', label: '成功' };
  if (result === 'rejected') return { status: 'warning', label: '已拒绝' };
  return { status: 'error', label: '失败' };
}

export function NasPage() {
  const [refreshing, setRefreshing] = useState(false);

  const fetcher = useCallback((signal: AbortSignal) => fetchNasStatus({ signal }), []);
  const { data, loading, error, refetch } = useApi(fetcher);

  // Docker 操作状态
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    container: string;
    action: 'stop' | 'restart';
  } | null>(null);

  // 日志弹窗状态
  const [logsModal, setLogsModal] = useState<{
    container: string;
    tail: number;
    loading: boolean;
    logs: string;
    fetchedAt?: string;
    error?: string;
  } | null>(null);

  // 审计记录折叠区状态
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<DockerAuditEntry[] | null>(null);

  const loadAuditEntries = async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await fetchNasDockerAudit({ limit: 20 });
      setAuditEntries(res.entries);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : '加载审计记录失败');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchNasStatus({ refresh: true });
      await refetch();
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRunDockerAction = async (container: string, action: DockerAction) => {
    const key = `${container}:${action}`;
    setActionLoadingKey(key);
    setActionFeedback(null);
    setConfirmModal(null);

    try {
      const res = await executeNasDockerAction(container, action);
      setActionFeedback({ ok: true, message: res.message });
      await fetchNasStatus({ refresh: true });
      await refetch();
      if (auditOpen) {
        await loadAuditEntries();
      }
    } catch (err) {
      setActionFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Docker 容器操作失败',
      });
      if (auditOpen) {
        await loadAuditEntries();
      }
    } finally {
      setActionLoadingKey(null);
    }
  };

  const loadContainerLogs = async (container: string, tail: number) => {
    setLogsModal({
      container,
      tail,
      loading: true,
      logs: '',
    });
    try {
      const res = await fetchNasDockerLogs(container, { tail });
      setLogsModal({
        container,
        tail: res.tail,
        loading: false,
        logs: res.logs,
        fetchedAt: res.fetchedAt,
      });
    } catch (err) {
      setLogsModal({
        container,
        tail,
        loading: false,
        logs: '',
        error: err instanceof Error ? err.message : '获取容器日志失败',
      });
    }
  };

  const handleToggleAudit = async () => {
    const nextOpen = !auditOpen;
    setAuditOpen(nextOpen);
    if (nextOpen) {
      await loadAuditEntries();
    }
  };

  const actionsEnabled = Boolean(data?.data?.docker.actionsEnabled);

  return (
    <div className="space-y-6">
      <PageHeader
        title="NAS"
        description="Linux NAS 只读硬件状态、传感器温度、RAID 阵列、存储卷与 Docker 容器管理。"
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
        <LoadingState variant="skeleton" rows={6} message="正在采集 NAS 状态..." />
      ) : error && !data ? (
        <ErrorState
          title="获取 NAS 状态失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !data || !data.configured ? (
        <EmptyState
          title="尚未配置 NAS"
          description="请前往设置页填写 NAS SSH 连接参数，或在环境变量中启用 NAS_MOCK=true。"
          icon={Server}
          action={
            <Link
              to="/settings"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              前往设置
            </Link>
          }
        />
      ) : !data.online || !data.data ? (
        <ErrorState
          title="NAS 离线或采集失败"
          message={data.error ?? '无法连接 NAS，请检查 SSH 配置与主机状态'}
          onRetry={() => void handleForceRefresh()}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status="success" label="在线" />
            {data.mock ? <StatusBadge status="info" label="模拟数据" showDot={false} /> : null}
            {data.cached ? <StatusBadge status="unknown" label="缓存命中" showDot={false} /> : null}
            <span>最近采集：{formatDateTime(data.checkedAt)}</span>
          </div>

          {/* 系统信息与 CPU/内存 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Server className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>系统信息</span>
                  </CardTitle>
                  <span className="font-mono text-xs text-muted-foreground">
                    {data.data.hostname}
                  </span>
                </div>
                <CardDescription>{data.data.osVersion}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">运行时长</div>
                  <div className="mt-1 font-semibold text-foreground">
                    {formatUptime(data.data.uptimeSeconds)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">平均负载（1 / 5 / 15 分钟）</div>
                  <div className="mt-1 font-mono font-semibold text-foreground">
                    {data.data.loadAvg.map((v) => v.toFixed(2)).join(' / ')}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>CPU 与内存</span>
                </CardTitle>
                <CardDescription>
                  {data.data.cpu.model}（{data.data.cpu.cores} 核）
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Cpu className="size-3.5" aria-hidden="true" />
                      <span>CPU 使用率</span>
                    </span>
                    <span className="font-medium text-foreground">
                      {data.data.cpu.loadPercent}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="CPU 使用率"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={data.data.cpu.loadPercent}
                    className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        getBarClassByThreshold(data.data.cpu.loadPercent, 75, 90),
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(0, data.data.cpu.loadPercent))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MemoryStick className="size-3.5" aria-hidden="true" />
                      <span>
                        内存（{formatBytes(data.data.memory.usedBytes)} /{' '}
                        {formatBytes(data.data.memory.totalBytes)}）
                      </span>
                    </span>
                    <span className="font-medium text-foreground">
                      {data.data.memory.usedPercent}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="内存使用率"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={data.data.memory.usedPercent}
                    className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        getBarClassByThreshold(data.data.memory.usedPercent, 80, 90),
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(0, data.data.memory.usedPercent))}%`,
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 温度卡 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Thermometer className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>传感器温度</span>
                </CardTitle>
                {data.data.maxTemperatureC !== null ? (
                  <StatusBadge
                    status={getTempVariant(data.data.maxTemperatureC)}
                    label={`最高 ${data.data.maxTemperatureC}℃`}
                  />
                ) : null}
              </div>
              <CardDescription>
                {data.data.smart.available
                  ? `已读取 ${data.data.smart.disks.length} 块硬盘 SMART 温度`
                  : `硬盘 SMART 温度：${data.data.smart.reason ?? '已跳过'}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.data.temperatures.length === 0 && !data.data.smart.available ? (
                <p className="text-sm text-muted-foreground">暂无可用温度传感器数据</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {data.data.temperatures.map((group) => (
                    <div
                      key={group.category}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
                    >
                      <div>
                        <div className="text-xs font-medium text-foreground">{group.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {group.sensors.length} 个测点
                        </div>
                      </div>
                      <StatusBadge
                        status={getTempVariant(group.maxTempC)}
                        label={`${group.maxTempC}℃`}
                        showDot={false}
                      />
                    </div>
                  ))}
                  {data.data.smart.available
                    ? data.data.smart.disks.map((disk) => (
                        <div
                          key={disk.device}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs font-medium text-foreground">
                              {disk.device}
                            </div>
                            {disk.model ? (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {disk.model}
                              </div>
                            ) : null}
                          </div>
                          <StatusBadge
                            status={getTempVariant(disk.tempC)}
                            label={`${disk.tempC}℃`}
                            showDot={false}
                          />
                        </div>
                      ))
                    : null}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 存储卡（RAID + 卷） */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>存储与 RAID 阵列</span>
              </CardTitle>
              <CardDescription>展示软件 RAID 阵列健康度及挂载卷容量使用情况。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {data.data.raids.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground">RAID 阵列</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {data.data.raids.map((raid) => (
                      <div
                        key={raid.name}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-foreground">
                              {raid.name}
                            </span>
                            <span className="text-xs uppercase text-muted-foreground">
                              {raid.level}
                            </span>
                            {raid.stateFlags ? (
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                {raid.stateFlags}
                              </code>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            成员：{raid.members.join(', ')}
                          </div>
                        </div>
                        <StatusBadge
                          status={raid.healthy ? 'success' : 'error'}
                          label={raid.statusLabel}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground">存储卷</h3>
                {data.data.volumes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">未检测到可用存储卷</p>
                ) : (
                  <div className="space-y-3">
                    {data.data.volumes.map((vol) => {
                      const level = getVolumeLevel(vol.usedPercent);
                      return (
                        <div key={vol.mount} className="space-y-1.5 rounded-lg bg-muted/30 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-foreground">
                                {vol.mount}
                              </span>
                              <span className="text-muted-foreground">
                                {vol.device} · {vol.fsType}
                              </span>
                            </div>
                            <span className="font-medium text-foreground">
                              已用 {formatBytes(vol.usedBytes)} / {formatBytes(vol.totalBytes)}
                              （可用 {formatBytes(vol.availableBytes)}，{vol.usedPercent}%）
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`${vol.mount} 使用率`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={vol.usedPercent}
                            data-level={level}
                            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                getBarClassByThreshold(vol.usedPercent, 80, 90),
                              )}
                              style={{
                                width: `${Math.min(100, Math.max(0, vol.usedPercent))}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Docker 容器卡片网格 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Container className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>Docker 容器</span>
                </CardTitle>
                {data.data.docker.available && !actionsEnabled ? (
                  <StatusBadge status="unknown" label="Docker 操作未开启" showDot={false} />
                ) : null}
              </div>
              <CardDescription>
                查看宿主机 Docker 容器状态、实时资源占用与只读日志；受保护容器不允许停止或重启。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.data.docker.available && !actionsEnabled ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Docker 操作未开启，当前仅支持只读状态与日志查看（可在环境变量设置{' '}
                    <code>DOCKER_ACTIONS_ENABLED=true</code> 启用受限操作）。
                  </span>
                </div>
              ) : null}

              {actionFeedback ? (
                <div
                  role={actionFeedback.ok ? 'status' : 'alert'}
                  className={
                    actionFeedback.ok
                      ? 'flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400'
                      : 'flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400'
                  }
                >
                  {actionFeedback.ok ? (
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>{actionFeedback.message}</span>
                </div>
              ) : null}

              {!data.data.docker.available ? (
                <EmptyState
                  title="Docker 信息不可用"
                  description={data.data.docker.reason ?? '无法获取 Docker 容器列表'}
                  icon={Container}
                />
              ) : data.data.docker.containers.length === 0 ? (
                <EmptyState
                  title="暂无容器"
                  description="当前宿主机上没有任何 Docker 容器。"
                  icon={Container}
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.data.docker.containers.map((c) => {
                    const badge = getContainerStatusBadge(c);
                    const startKey = `${c.name}:start`;
                    const stopKey = `${c.name}:stop`;
                    const restartKey = `${c.name}:restart`;
                    const isBusy =
                      actionLoadingKey === startKey ||
                      actionLoadingKey === stopKey ||
                      actionLoadingKey === restartKey;

                    return (
                      <div
                        key={c.id}
                        className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {c.name}
                                </span>
                                {c.protected ? (
                                  <StatusBadge status="info" label="受保护" showDot={false} />
                                ) : null}
                              </div>
                              <div className="truncate font-mono text-[11px] text-muted-foreground">
                                {c.image}
                              </div>
                            </div>
                            <StatusBadge status={badge.status} label={badge.label} />
                          </div>

                          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2.5 text-xs">
                            <div>
                              <div className="text-[11px] text-muted-foreground">CPU</div>
                              <div className="font-mono font-medium text-foreground">
                                {c.cpuPercent || '-'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">内存</div>
                              <div className="truncate font-mono font-medium text-foreground">
                                {c.memUsage
                                  ? `${c.memUsage}${c.memPercent ? ` (${c.memPercent})` : ''}`
                                  : '-'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">运行时长</div>
                              <div className="truncate text-foreground">{c.runningFor || '-'}</div>
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">端口</div>
                              <div className="truncate font-mono text-foreground">
                                {c.ports || '-'}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                          {actionsEnabled ? (
                            badge.stopped ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                aria-label={`启动 ${c.name}`}
                                disabled={isBusy}
                                onClick={() => void handleRunDockerAction(c.name, 'start')}
                              >
                                <Play className="size-3.5" aria-hidden="true" />
                                <span>{actionLoadingKey === startKey ? '启动中...' : '启动'}</span>
                              </Button>
                            ) : !c.protected ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-label={`停止 ${c.name}`}
                                  disabled={isBusy}
                                  onClick={() =>
                                    setConfirmModal({ container: c.name, action: 'stop' })
                                  }
                                >
                                  <Square className="size-3.5" aria-hidden="true" />
                                  <span>{actionLoadingKey === stopKey ? '停止中...' : '停止'}</span>
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-label={`重启 ${c.name}`}
                                  disabled={isBusy}
                                  onClick={() =>
                                    setConfirmModal({ container: c.name, action: 'restart' })
                                  }
                                >
                                  <RotateCw
                                    className={
                                      actionLoadingKey === restartKey
                                        ? 'size-3.5 animate-spin'
                                        : 'size-3.5'
                                    }
                                    aria-hidden="true"
                                  />
                                  <span>
                                    {actionLoadingKey === restartKey ? '重启中...' : '重启'}
                                  </span>
                                </Button>
                              </>
                            ) : null
                          ) : null}

                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`日志 ${c.name}`}
                            onClick={() => void loadContainerLogs(c.name, 200)}
                          >
                            <FileText className="size-3.5" aria-hidden="true" />
                            <span>日志</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 折叠式 Docker 操作审计日志 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="text-base">Docker 操作审计记录</CardTitle>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleToggleAudit()}
                >
                  {auditOpen ? (
                    <>
                      <ChevronUp className="size-4" aria-hidden="true" />
                      <span>收起审计记录</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-4" aria-hidden="true" />
                      <span>查看最近 20 条审计记录</span>
                    </>
                  )}
                </Button>
              </div>
              <CardDescription>
                记录所有 Docker 容器启停与重启请求（包括被策略拒绝的操作）。
              </CardDescription>
            </CardHeader>
            {auditOpen ? (
              <CardContent>
                {auditLoading ? (
                  <LoadingState variant="skeleton" rows={3} message="正在加载审计记录..." />
                ) : auditError ? (
                  <ErrorState
                    title="加载审计记录失败"
                    message={auditError}
                    onRetry={() => void loadAuditEntries()}
                  />
                ) : !auditEntries || auditEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 Docker 操作审计记录</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">时间</th>
                          <th className="py-2 pr-4 font-medium">操作者</th>
                          <th className="py-2 pr-4 font-medium">来源 IP</th>
                          <th className="py-2 pr-4 font-medium">容器</th>
                          <th className="py-2 pr-4 font-medium">动作</th>
                          <th className="py-2 pr-4 font-medium">结果</th>
                          <th className="py-2 pr-4 font-medium">耗时</th>
                          <th className="py-2 font-medium">备注</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {auditEntries.map((entry, idx) => {
                          const badge = getAuditResultBadge(entry.result);
                          return (
                            <tr key={`${entry.timestamp}-${entry.container}-${idx}`}>
                              <td className="py-2 pr-4 text-muted-foreground">
                                {formatDateTime(entry.timestamp)}
                              </td>
                              <td className="py-2 pr-4 font-medium text-foreground">
                                {entry.username}
                              </td>
                              <td className="py-2 pr-4 font-mono text-muted-foreground">
                                {entry.clientIp}
                              </td>
                              <td className="py-2 pr-4 font-mono text-foreground">
                                {entry.container}
                              </td>
                              <td className="py-2 pr-4 font-mono text-muted-foreground">
                                {entry.action}
                              </td>
                              <td className="py-2 pr-4">
                                <StatusBadge status={badge.status} label={badge.label} />
                              </td>
                              <td className="py-2 pr-4 text-muted-foreground">
                                {entry.durationMs} ms
                              </td>
                              <td className="py-2 text-muted-foreground">{entry.error ?? '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            ) : null}
          </Card>
        </div>
      )}

      {/* 停止 / 重启二次确认对话框 */}
      {confirmModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="docker-confirm-title"
        >
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle id="docker-confirm-title" className="text-base">
                {confirmModal.action === 'stop' ? '确认停止容器' : '确认重启容器'}
              </CardTitle>
              <CardDescription>
                即将对容器 <code className="font-mono font-semibold">{confirmModal.container}</code>{' '}
                执行{confirmModal.action === 'stop' ? '停止' : '重启'}操作，是否继续？
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmModal(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant={confirmModal.action === 'stop' ? 'destructive' : 'default'}
                size="sm"
                onClick={() =>
                  void handleRunDockerAction(confirmModal.container, confirmModal.action)
                }
              >
                {confirmModal.action === 'stop' ? '确认停止' : '确认重启'}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* 容器日志对话框 */}
      {logsModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="docker-logs-title"
        >
          <Card className="flex max-h-[85vh] w-full max-w-3xl flex-col shadow-xl">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle id="docker-logs-title" className="text-base">
                  容器日志：{logsModal.container}
                </CardTitle>
                <CardDescription>
                  {logsModal.fetchedAt
                    ? `最近刷新：${formatDateTime(logsModal.fetchedAt)}`
                    : '只读查看最近容器输出日志'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="docker-logs-tail" className="text-xs text-muted-foreground">
                  行数
                </label>
                <select
                  id="docker-logs-tail"
                  value={String(logsModal.tail)}
                  onChange={(e) =>
                    void loadContainerLogs(logsModal.container, Number(e.target.value))
                  }
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="500">500</option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={logsModal.loading}
                  onClick={() => void loadContainerLogs(logsModal.container, logsModal.tail)}
                >
                  <RotateCw
                    className={logsModal.loading ? 'size-3.5 animate-spin' : 'size-3.5'}
                    aria-hidden="true"
                  />
                  <span>刷新</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="关闭日志弹窗"
                  onClick={() => setLogsModal(null)}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              {logsModal.loading ? (
                <LoadingState variant="spinner" message="正在读取容器日志..." />
              ) : logsModal.error ? (
                <ErrorState
                  title="获取容器日志失败"
                  message={logsModal.error}
                  onRetry={() => void loadContainerLogs(logsModal.container, logsModal.tail)}
                />
              ) : (
                <pre className="max-h-[55vh] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                  {logsModal.logs || '暂无日志输出'}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export default NasPage;
