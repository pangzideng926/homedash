import { useCallback, useState, type FormEvent } from 'react';
import {
  Clock,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  Monitor,
  Pencil,
  PlugZap,
  Plus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import {
  CardGrid,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  SectionCard,
  StatusBadge,
} from '@/components/common';
import { DeviceOsIcon } from '@/components/devices/DeviceOsIcon';
import {
  formatBytes,
  formatDateTime,
  formatUptime,
  getOsLabel,
} from '@/components/devices/device-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApi } from '@/hooks/useApi';
import {
  fetchDevicesList,
  fetchDevicesStatus,
  fetchDeviceStatus,
  saveDevicesList,
  testDeviceConnection,
  type DetectedOs,
  type DeviceInput,
  type DeviceListResponse,
  type DeviceOsConfig,
  type DeviceRecord,
  type DevicesStatusResponse,
  type DeviceStatusItem,
  type DeviceTestResponse,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface DeviceFormValues {
  name: string;
  host: string;
  port: string;
  user: string;
  keyPath: string;
  os: DeviceOsConfig;
  enabled: boolean;
  note: string;
}

const EMPTY_FORM: DeviceFormValues = {
  name: '',
  host: '',
  port: '22',
  user: '',
  keyPath: '',
  os: 'auto',
  enabled: true,
  note: '',
};

function toDeviceInput(device: DeviceRecord): DeviceInput {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    port: device.port,
    user: device.user,
    keyPath: device.keyPath,
    os: device.os,
    enabled: device.enabled,
    note: device.note,
  };
}

function toFormValues(device: DeviceRecord): DeviceFormValues {
  return {
    name: device.name,
    host: device.host,
    port: String(device.port),
    user: device.user,
    keyPath: device.keyPath,
    os: device.os,
    enabled: device.enabled,
    note: device.note ?? '',
  };
}

function parsePortValue(portText: string): number | null {
  const trimmed = portText.trim();
  if (!trimmed) return 22;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}

function validateFormValues(
  values: DeviceFormValues,
  requireName: boolean,
): { ok: true; payload: DeviceInput } | { ok: false; message: string } {
  const name = values.name.trim();
  if (requireName && !name) {
    return { ok: false, message: '请输入设备名称' };
  }

  const host = values.host.trim();
  if (!host) {
    return { ok: false, message: '请输入主机地址' };
  }

  const port = parsePortValue(values.port);
  if (port === null) {
    return { ok: false, message: '端口必须是 1 到 65535 之间的整数' };
  }

  const user = values.user.trim();
  if (!user) {
    return { ok: false, message: '请输入 SSH 用户名' };
  }

  const keyPath = values.keyPath.trim();
  if (!keyPath) {
    return { ok: false, message: '请填写服务器上私钥文件的路径' };
  }

  return {
    ok: true,
    payload: {
      name: name || host,
      host,
      port,
      user,
      keyPath,
      os: values.os,
      enabled: values.enabled,
      note: values.note.trim() || null,
    },
  };
}

function resolveCardOs(
  record: DeviceRecord | undefined,
  statusItem: DeviceStatusItem | undefined,
): DetectedOs {
  if (statusItem && statusItem.os !== 'unknown') {
    return statusItem.os;
  }
  if (record && record.os !== 'auto') {
    return record.os;
  }
  return statusItem?.os ?? 'unknown';
}

interface CombinedDeviceCardModel {
  id: string;
  name: string;
  record?: DeviceRecord;
  statusItem?: DeviceStatusItem;
  enabled: boolean;
}

function buildDeviceCardModels(
  listData: DeviceListResponse | null,
  statusData: DevicesStatusResponse | null,
  overrides: Record<string, DeviceStatusItem>,
): CombinedDeviceCardModel[] {
  const statusMap = new Map<string, DeviceStatusItem>();
  for (const item of statusData?.devices ?? []) {
    statusMap.set(item.id, item);
  }
  for (const [id, item] of Object.entries(overrides)) {
    statusMap.set(id, item);
  }

  if (listData?.devices && listData.devices.length > 0) {
    return listData.devices.map((record) => ({
      id: record.id,
      name: record.name,
      record,
      statusItem: statusMap.get(record.id),
      enabled: record.enabled,
    }));
  }

  return (statusData?.devices ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    statusItem: overrides[item.id] ?? item,
    enabled: true,
  }));
}

export function DevicesPage() {
  const fetchCombined = useCallback(async (signal: AbortSignal) => {
    const [listRes, statusRes] = await Promise.all([
      fetchDevicesList(signal),
      fetchDevicesStatus({ signal }),
    ]);
    return { list: listRes, status: statusRes };
  }, []);

  const { data, loading, error, refetch } = useApi(fetchCombined);
  const [localList, setLocalList] = useState<DeviceListResponse | null>(null);
  const [localStatus, setLocalStatus] = useState<DevicesStatusResponse | null>(null);
  const [cardOverrides, setCardOverrides] = useState<Record<string, DeviceStatusItem>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<DeviceFormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DeviceTestResponse | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const listData = localList ?? data?.list ?? null;
  const statusData = localStatus ?? data?.status ?? null;
  const isReadonly = Boolean(listData?.readonly ?? statusData?.readonly);
  const readonlyReason = listData?.readonlyReason ?? statusData?.readonlyReason;
  const configured = listData?.configured ?? statusData?.configured ?? false;
  const configError = listData?.error ?? statusData?.error;
  const configErrorCode = listData?.errorCode ?? statusData?.errorCode;
  const canEdit = Boolean(configured && !configError && !isReadonly);

  const cardModels = buildDeviceCardModels(listData, statusData, cardOverrides);

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setActionError(null);
    setConfirmDeleteId(null);
    try {
      const [nextList, nextStatus] = await Promise.all([
        fetchDevicesList(),
        fetchDevicesStatus({ refresh: true }),
      ]);
      setLocalList(nextList);
      setLocalStatus(nextStatus);
      setCardOverrides({});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '刷新设备状态失败，请稍后重试');
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleRefreshSingle = async (id: string) => {
    setRefreshingIds((prev) => ({ ...prev, [id]: true }));
    setActionError(null);
    try {
      const updated = await fetchDeviceStatus(id, { refresh: true });
      setCardOverrides((prev) => ({ ...prev, [id]: updated }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '刷新设备状态失败，请稍后重试');
    } finally {
      setRefreshingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const openAddForm = () => {
    setEditingIndex(null);
    setFormValues(EMPTY_FORM);
    setFormError(null);
    setTestResult(null);
    setActionError(null);
    setFormOpen(true);
  };

  const openEditForm = (index: number, record: DeviceRecord) => {
    setEditingIndex(index);
    setFormValues(toFormValues(record));
    setFormError(null);
    setTestResult(null);
    setActionError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingIndex(null);
    setFormError(null);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    const validation = validateFormValues(formValues, false);
    if (!validation.ok) {
      setFormError(validation.message);
      setTestResult(null);
      return;
    }

    setTesting(true);
    setFormError(null);
    setTestResult(null);
    try {
      const result = await testDeviceConnection({
        name: validation.payload.name,
        host: validation.payload.host,
        port: validation.payload.port,
        user: validation.payload.user,
        keyPath: validation.payload.keyPath,
        os: validation.payload.os,
      });
      setTestResult(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '测试连接失败，请稍后重试');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!listData || isReadonly) return;

    const validation = validateFormValues(formValues, true);
    if (!validation.ok) {
      setFormError(validation.message);
      return;
    }

    const baseList = listData.devices.map(toDeviceInput);
    if (editingIndex !== null && editingIndex >= 0 && editingIndex < baseList.length) {
      const target = baseList[editingIndex];
      baseList[editingIndex] = {
        ...validation.payload,
        ...(target?.id ? { id: target.id } : {}),
      };
    } else {
      baseList.push(validation.payload);
    }

    setSaving(true);
    setFormError(null);
    setActionError(null);
    try {
      const updatedList = await saveDevicesList(baseList);
      setLocalList(updatedList);
      setCardOverrides({});
      closeForm();
      const updatedStatus = await fetchDevicesStatus({ refresh: true });
      setLocalStatus(updatedStatus);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存设备失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (!listData || isReadonly) return;
    const nextList = listData.devices.filter((_, i) => i !== index).map(toDeviceInput);

    setSaving(true);
    setActionError(null);
    try {
      const updatedList = await saveDevicesList(nextList);
      setLocalList(updatedList);
      setConfirmDeleteId(null);
      setCardOverrides({});
      const updatedStatus = await fetchDevicesStatus({ refresh: true });
      setLocalStatus(updatedStatus);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除设备失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const isBusy = loading || refreshingAll;

  return (
    <div className="space-y-6">
      <PageHeader
        title="家用设备"
        description="家用 Windows / macOS / Linux 主机只读状态与硬件资源监控"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isReadonly ? <StatusBadge status="info" label="只读模式" showDot={false} /> : null}
            {canEdit ? (
              <Button type="button" size="sm" onClick={openAddForm} disabled={saving || isBusy}>
                <Plus className="size-4" aria-hidden="true" />
                <span>添加设备</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void (data ? handleRefreshAll() : refetch())}
              disabled={isBusy || saving}
            >
              <RotateCw className={isBusy ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
              <span>{refreshingAll ? '刷新中...' : '刷新全部'}</span>
            </Button>
          </div>
        }
      />

      {loading && !listData && !statusData ? (
        <LoadingState variant="skeleton" rows={4} message="正在采集家用设备状态..." />
      ) : error && !listData && !statusData ? (
        <ErrorState
          title="获取家用设备状态失败"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : !configured || configErrorCode === 'UNCONFIGURED' ? (
        <EmptyState
          title="尚未配置家用设备"
          description={
            configError ??
            '请在环境变量中配置 DEVICES_FILE 指向本地 JSON，或设置 DEVICES_MOCK=true。'
          }
          icon={Monitor}
        />
      ) : configError ? (
        <ErrorState
          title="设备清单读取失败"
          message={configError}
          onRetry={() => void handleRefreshAll()}
        />
      ) : (
        <>
          {isReadonly && readonlyReason ? (
            <div
              role="note"
              className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-900 dark:text-sky-200"
            >
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{readonlyReason}</span>
            </div>
          ) : null}

          {actionError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {actionError}
            </div>
          ) : null}

          {formOpen && !isReadonly ? (
            <SectionCard
              title={editingIndex !== null ? '编辑家用设备' : '添加家用设备'}
              subtitle="仅支持通过服务器本地 SSH 私钥进行只读状态采集，不提供私钥上传或远程修改操作。"
            >
              <form onSubmit={(e) => void handleSaveForm(e)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="device-name">名称 *</Label>
                    <Input
                      id="device-name"
                      value={formValues.name}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="例如：书房 Mac mini"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device-host">主机 *</Label>
                    <Input
                      id="device-host"
                      value={formValues.host}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="例如：192.0.2.21 或 demo-mac.local"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device-port">端口</Label>
                    <Input
                      id="device-port"
                      type="number"
                      min="1"
                      max="65535"
                      value={formValues.port}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, port: e.target.value }))}
                      placeholder="22"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device-user">用户 *</Label>
                    <Input
                      id="device-user"
                      value={formValues.user}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, user: e.target.value }))}
                      placeholder="例如：demo"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device-os">系统</Label>
                    <select
                      id="device-os"
                      value={formValues.os}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          os: e.target.value as DeviceOsConfig,
                        }))
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="auto">自动识别</option>
                      <option value="windows">Windows</option>
                      <option value="macos">macOS</option>
                      <option value="linux">Linux</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device-note">备注</Label>
                    <Input
                      id="device-note"
                      value={formValues.note}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, note: e.target.value }))}
                      placeholder="可选备注信息"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="device-keyPath">密钥路径 *</Label>
                  <Input
                    id="device-keyPath"
                    value={formValues.keyPath}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, keyPath: e.target.value }))
                    }
                    placeholder="./secrets/demo_id_ed25519"
                  />
                  <p className="text-xs text-muted-foreground">
                    填写服务器上私钥文件的路径，不会上传或显示私钥
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="device-enabled"
                    type="checkbox"
                    checked={formValues.enabled}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    className="size-4 rounded border-input accent-primary"
                  />
                  <Label htmlFor="device-enabled" className="cursor-pointer font-normal">
                    启用此设备状态采集
                  </Label>
                </div>

                {formError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                ) : null}

                {testResult ? (
                  <div
                    role="status"
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm',
                      testResult.ok
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-destructive/40 bg-destructive/10 text-destructive',
                    )}
                  >
                    {testResult.ok
                      ? `连接测试成功：识别系统 ${getOsLabel(testResult.os ?? 'unknown')}（耗时 ${testResult.durationMs} ms）`
                      : `连接测试失败：${testResult.error ?? '请检查配置'}（耗时 ${testResult.durationMs} ms）`}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTestConnection()}
                    disabled={testing || saving}
                  >
                    <PlugZap className="size-4" aria-hidden="true" />
                    <span>{testing ? '测试中...' : '测试连接'}</span>
                  </Button>
                  <Button type="submit" size="sm" disabled={saving || testing}>
                    {saving ? '保存中...' : '保存'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={closeForm}
                    disabled={saving || testing}
                  >
                    取消
                  </Button>
                </div>
              </form>
            </SectionCard>
          ) : null}

          {cardModels.length === 0 ? (
            <EmptyState
              title="暂无家用设备"
              description={
                isReadonly
                  ? '当前设备清单为空，且处于只读模式。'
                  : '点击右上角“添加设备”配置第一台 Windows / macOS / Linux 主机。'
              }
              icon={Monitor}
              action={
                canEdit ? (
                  <Button type="button" size="sm" onClick={openAddForm}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>添加设备</span>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <CardGrid columns={2}>
              {cardModels.map((model, index) => {
                const { record, statusItem, enabled } = model;
                const osType = resolveCardOs(record, statusItem);
                const isCardRefreshing = Boolean(refreshingIds[model.id]);
                const isConfirmingDelete = confirmDeleteId === model.id;
                const osVersionText = statusItem?.data?.osVersion ?? getOsLabel(osType);

                return (
                  <SectionCard
                    key={model.id}
                    leading={
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <DeviceOsIcon os={osType} className="size-4" />
                      </div>
                    }
                    title={model.name}
                    titleClassName="truncate"
                    titleExtra={
                      <>
                        {!enabled ? (
                          <StatusBadge status="unconfigured" label="已停用" />
                        ) : (
                          <StatusBadge status={statusItem?.online ? 'online' : 'offline'} />
                        )}
                        {enabled && statusItem ? (
                          <StatusBadge
                            status={statusItem.cached ? 'info' : 'configured'}
                            label={statusItem.cached ? '已缓存' : '实时采集'}
                            showDot={false}
                          />
                        ) : null}
                      </>
                    }
                    subtitle={
                      <span className="block truncate">
                        {osVersionText}
                        {record?.note ? ` · ${record.note}` : ''}
                      </span>
                    }
                    actions={
                      <div className="flex shrink-0 items-center gap-1">
                        {enabled ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`刷新 ${model.name}`}
                            onClick={() => void handleRefreshSingle(model.id)}
                            disabled={isCardRefreshing || refreshingAll || saving}
                          >
                            <RotateCw
                              className={isCardRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'}
                              aria-hidden="true"
                            />
                            <span>刷新</span>
                          </Button>
                        ) : null}

                        {canEdit && record ? (
                          isConfirmingDelete ? (
                            <div className="inline-flex items-center gap-1">
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => void handleDelete(index)}
                                disabled={saving}
                              >
                                确认删除
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={saving}
                              >
                                取消
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`编辑 ${model.name}`}
                                onClick={() => openEditForm(index, record)}
                                disabled={saving}
                              >
                                <Pencil className="size-3.5" aria-hidden="true" />
                                <span>编辑</span>
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`删除 ${model.name}`}
                                onClick={() => setConfirmDeleteId(model.id)}
                                disabled={saving}
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                                <span>删除</span>
                              </Button>
                            </>
                          )
                        ) : null}
                      </div>
                    }
                    footer={
                      statusItem ? (
                        <div className="flex w-full items-center justify-between border-t border-border/60 pt-2">
                          <span>刷新时间：{formatDateTime(statusItem.checkedAt)}</span>
                          <span>{statusItem.cached ? '命中缓存' : '实时采集'}</span>
                        </div>
                      ) : undefined
                    }
                  >
                    {!enabled ? (
                      <EmptyState compact hideIcon title="此设备已停用，暂不进行只读状态采集" />
                    ) : !statusItem ? (
                      <EmptyState compact hideIcon title="暂无采集状态，请点击刷新" />
                    ) : !statusItem.online || !statusItem.data ? (
                      <ErrorState
                        compact
                        title="设备离线或采集失败"
                        message={statusItem.error ?? '无法获取设备运行状态'}
                        onRetry={() => void handleRefreshSingle(model.id)}
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs sm:grid-cols-3">
                          <div>
                            <span className="text-muted-foreground">主机名</span>
                            <p className="truncate font-medium text-foreground">
                              {statusItem.data.hostname}
                            </p>
                          </div>
                          <div>
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="size-3" aria-hidden="true" />
                              <span>开机时长</span>
                            </span>
                            <p className="font-medium text-foreground">
                              {formatUptime(statusItem.data.uptimeSeconds)}
                            </p>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <span className="text-muted-foreground">系统</span>
                            <p className="font-medium text-foreground">
                              {getOsLabel(statusItem.data.os)}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <ProgressBar
                            ariaLabel={`${model.name} CPU 使用率`}
                            label={
                              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Cpu className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">
                                  {statusItem.data.cpu.model}
                                  {statusItem.data.cpu.cores > 0
                                    ? ` (${statusItem.data.cpu.cores} 核)`
                                    : ''}
                                </span>
                              </span>
                            }
                            valueText={
                              <span className="text-sm">{statusItem.data.cpu.loadPercent}%</span>
                            }
                            value={statusItem.data.cpu.loadPercent}
                          />

                          <ProgressBar
                            ariaLabel={`${model.name} 内存使用率`}
                            label={
                              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <MemoryStick className="size-3.5 shrink-0" aria-hidden="true" />
                                <span>内存</span>
                              </span>
                            }
                            valueText={
                              <span className="text-sm">
                                {formatBytes(statusItem.data.memory.usedBytes)} /{' '}
                                {formatBytes(statusItem.data.memory.totalBytes)} (
                                {statusItem.data.memory.usedPercent}%)
                              </span>
                            }
                            value={statusItem.data.memory.usedPercent}
                          />

                          <div className="space-y-2 border-t border-border/60 pt-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <HardDrive className="size-3.5" aria-hidden="true" />
                              <span>磁盘空间</span>
                            </div>
                            {statusItem.data.disks.length === 0 ? (
                              <p className="text-xs text-muted-foreground">未检测到本地磁盘</p>
                            ) : (
                              statusItem.data.disks.map((disk) => {
                                const usedBytes = Math.max(0, disk.totalBytes - disk.freeBytes);
                                const diskTitle = disk.label
                                  ? `${disk.mount} (${disk.label})`
                                  : disk.mount;
                                return (
                                  <ProgressBar
                                    key={disk.mount}
                                    ariaLabel={`${model.name} ${disk.mount} 磁盘使用率`}
                                    label={
                                      <span className="font-medium text-foreground">
                                        {diskTitle}
                                      </span>
                                    }
                                    valueText={
                                      <span className="font-normal text-muted-foreground">
                                        已用 {formatBytes(usedBytes)} /{' '}
                                        {formatBytes(disk.totalBytes)}（可用{' '}
                                        {formatBytes(disk.freeBytes)}，{disk.usedPercent}%）
                                      </span>
                                    }
                                    value={disk.usedPercent}
                                  />
                                );
                              })
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </SectionCard>
                );
              })}
            </CardGrid>
          )}
        </>
      )}
    </div>
  );
}

export default DevicesPage;
