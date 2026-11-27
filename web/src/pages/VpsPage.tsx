import { useState, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RotateCw,
  Server,
  Trash2,
} from 'lucide-react';
import {
  DataCard,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  type StatusVariant,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatMonthlyTraffic,
  formatVpsCardTitle,
  formatVpsPrice,
  isLongNote,
  isValidIpInput,
  maskIpAddress,
} from '@/components/vps/vps-utils';
import { useApi } from '@/hooks/useApi';
import {
  fetchVpsList,
  saveVpsList,
  type VpsListResponse,
  type VpsServerInput,
  type VpsServerView,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface VpsFormValues {
  name: string;
  region: string;
  ip: string;
  monthlyTrafficGB: string;
  role: string;
  provider: string;
  expiresAt: string;
  price: string;
  currency: string;
  renewUrl: string;
  note: string;
}

const EMPTY_FORM: VpsFormValues = {
  name: '',
  region: '',
  ip: '',
  monthlyTrafficGB: '',
  role: '',
  provider: '',
  expiresAt: '',
  price: '',
  currency: 'CNY',
  renewUrl: '',
  note: '',
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function getLevelBadgeProps(server: VpsServerView): { status: StatusVariant; label: string } {
  if (server.error || server.daysLeft === null || server.level === null) {
    return { status: 'error', label: '格式错误' };
  }
  if (server.level === 'expired') {
    return { status: 'error', label: `已过期 ${Math.abs(server.daysLeft)} 天` };
  }
  if (server.level === 'danger') {
    return {
      status: 'error',
      label: server.daysLeft === 0 ? '今天到期' : `剩余 ${server.daysLeft} 天`,
    };
  }
  if (server.level === 'warning') {
    return { status: 'warning', label: `剩余 ${server.daysLeft} 天` };
  }
  return { status: 'success', label: `剩余 ${server.daysLeft} 天` };
}

function getCountdownPanelStyles(server: VpsServerView): {
  containerClass: string;
  accentClass: string;
} {
  if (
    server.error ||
    server.daysLeft === null ||
    server.level === null ||
    server.level === 'expired' ||
    server.level === 'danger'
  ) {
    return {
      containerClass: 'border-red-500/25 bg-red-500/5',
      accentClass: 'text-red-600 dark:text-red-400',
    };
  }
  if (server.level === 'warning') {
    return {
      containerClass: 'border-amber-500/25 bg-amber-500/5',
      accentClass: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    containerClass: 'border-emerald-500/25 bg-emerald-500/5',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
  };
}

function toServerInput(server: VpsServerView): VpsServerInput {
  return {
    id: server.id,
    name: server.name,
    region: server.region ?? null,
    ip: server.ip ?? null,
    monthlyTrafficGB: server.monthlyTrafficGB ?? null,
    role: server.role ?? null,
    provider: server.provider,
    expiresAt: server.expiresAt,
    price: server.price,
    currency: server.currency,
    renewUrl: server.renewUrl,
    note: server.note,
  };
}

function toFormValues(server: VpsServerView): VpsFormValues {
  return {
    name: server.name,
    region: server.region ?? '',
    ip: server.ip ?? '',
    monthlyTrafficGB:
      server.monthlyTrafficGB !== null && server.monthlyTrafficGB !== undefined
        ? String(server.monthlyTrafficGB)
        : '',
    role: server.role ?? '',
    provider: server.provider ?? '',
    expiresAt: server.expiresAt,
    price: server.price !== null ? String(server.price) : '',
    currency: server.currency ?? '',
    renewUrl: server.renewUrl ?? '',
    note: server.note ?? '',
  };
}

function validateFormValues(
  values: VpsFormValues,
): { ok: true; payload: VpsServerInput } | { ok: false; message: string } {
  const name = values.name.trim();
  if (!name) {
    return { ok: false, message: '请输入服务器名称' };
  }

  const expiresAt = values.expiresAt.trim();
  if (!expiresAt) {
    return { ok: false, message: '请输入到期日期' };
  }
  if (!isValidCalendarDate(expiresAt)) {
    return { ok: false, message: '到期日期格式错误，应为 YYYY-MM-DD' };
  }

  const ipText = values.ip.trim();
  if (ipText !== '' && !isValidIpInput(ipText)) {
    return { ok: false, message: 'IP 地址格式错误，应为有效的 IPv4 或 IPv6 地址' };
  }

  const trafficText = values.monthlyTrafficGB.trim();
  let monthlyTrafficGB: number | null = null;
  if (trafficText !== '') {
    const parsedTraffic = Number(trafficText);
    if (!Number.isFinite(parsedTraffic) || parsedTraffic < 0) {
      return { ok: false, message: '月流量必须为大于或等于 0 的数字' };
    }
    monthlyTrafficGB = parsedTraffic;
  }

  const priceText = values.price.trim();
  let price: number | null = null;
  if (priceText !== '') {
    const parsedPrice = Number(priceText);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return { ok: false, message: '价格必须为大于或等于 0 的数字' };
    }
    price = parsedPrice;
  }

  const renewUrl = values.renewUrl.trim();
  if (renewUrl !== '') {
    try {
      const parsedUrl = new URL(renewUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return { ok: false, message: '续费链接必须是有效的 http:// 或 https:// 地址' };
      }
    } catch {
      return { ok: false, message: '续费链接必须是有效的 http:// 或 https:// 地址' };
    }
  }

  return {
    ok: true,
    payload: {
      name,
      region: values.region.trim() || null,
      ip: ipText || null,
      monthlyTrafficGB,
      role: values.role.trim() || null,
      provider: values.provider.trim() || null,
      expiresAt,
      price,
      currency: values.currency.trim() || null,
      renewUrl: renewUrl || null,
      note: values.note.trim() || null,
    },
  };
}

export function VpsPage() {
  const { data, loading, error, refetch } = useApi(fetchVpsList);
  const [localData, setLocalData] = useState<VpsListResponse | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<VpsFormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [revealedIpIds, setRevealedIpIds] = useState<Record<string, boolean>>({});
  const [expandedNoteIds, setExpandedNoteIds] = useState<Record<string, boolean>>({});

  const currentData = localData ?? data;
  const isReadonly = Boolean(currentData?.readonly);

  const toggleIpReveal = (id: string) => {
    setRevealedIpIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleNoteExpand = (id: string) => {
    setExpandedNoteIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRefresh = async () => {
    setLocalData(null);
    setActionError(null);
    setConfirmDeleteId(null);
    await refetch();
  };

  const openAddForm = () => {
    setEditingIndex(null);
    setFormValues(EMPTY_FORM);
    setFormError(null);
    setActionError(null);
    setFormOpen(true);
  };

  const openEditForm = (index: number, server: VpsServerView) => {
    setEditingIndex(index);
    setFormValues(toFormValues(server));
    setFormError(null);
    setActionError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingIndex(null);
    setFormError(null);
  };

  const handleSaveForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentData || isReadonly) return;

    const validation = validateFormValues(formValues);
    if (!validation.ok) {
      setFormError(validation.message);
      return;
    }

    const baseList = currentData.servers.map(toServerInput);
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
      const updated = await saveVpsList(baseList);
      setLocalData(updated);
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (!currentData || isReadonly) return;
    const nextList = currentData.servers.filter((_, i) => i !== index).map(toServerInput);

    setSaving(true);
    setActionError(null);
    try {
      const updated = await saveVpsList(nextList);
      setLocalData(updated);
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const canEdit = Boolean(currentData?.configured && !currentData.error && !isReadonly);

  return (
    <div className="space-y-6">
      <PageHeader
        title="VPS"
        description={
          currentData?.timezone
            ? `云服务器状态与到期提醒管理（按 ${currentData.timezone} 时区计算）`
            : '云服务器状态与到期提醒管理'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isReadonly ? <StatusBadge status="info" label="只读模式" showDot={false} /> : null}
            {canEdit ? (
              <Button type="button" size="sm" onClick={openAddForm} disabled={saving}>
                <Plus className="size-4" aria-hidden="true" />
                <span>新增 VPS</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={loading || saving}
            >
              <RotateCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
              <span>刷新</span>
            </Button>
          </div>
        }
      />

      {loading && !currentData ? (
        <LoadingState variant="skeleton" rows={4} message="正在加载 VPS 清单..." />
      ) : error && !currentData ? (
        <ErrorState
          title="加载 VPS 列表失败"
          message={error.message}
          onRetry={() => void handleRefresh()}
        />
      ) : !currentData || !currentData.configured || currentData.errorCode === 'UNCONFIGURED' ? (
        <EmptyState
          title="尚未配置 VPS 清单"
          description={
            currentData?.error ?? '请在环境变量中配置 VPS_LIST_FILE 指向本地 JSON 文件。'
          }
          icon={Server}
        />
      ) : currentData.error ? (
        <ErrorState
          title="VPS 清单文件读取失败"
          message={currentData.error}
          onRetry={() => void handleRefresh()}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DataCard title="服务器总数" value={currentData.summary.total} icon={Server} />
            <DataCard
              title="已过期"
              value={currentData.summary.expired}
              status={currentData.summary.expired > 0 ? 'error' : 'success'}
              statusLabel={currentData.summary.expired > 0 ? '需立即处理' : '无过期'}
            />
            <DataCard
              title="7 天内到期"
              value={currentData.summary.within7Days}
              status={currentData.summary.within7Days > 0 ? 'error' : 'success'}
              statusLabel={currentData.summary.within7Days > 0 ? '即将到期' : '正常'}
            />
            <DataCard
              title="30 天内到期"
              value={currentData.summary.within30Days}
              status={currentData.summary.within30Days > 0 ? 'warning' : 'success'}
              statusLabel={currentData.summary.within30Days > 0 ? '注意续费' : '正常'}
            />
          </div>

          {actionError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {actionError}
            </div>
          ) : null}

          {formOpen && !isReadonly ? (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">
                  {editingIndex !== null ? '编辑 VPS 条目' : '新增 VPS 条目'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={(e) => void handleSaveForm(e)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-name">名称 *</Label>
                      <Input
                        id="vps-name"
                        value={formValues.name}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, name: e.target.value }))
                        }
                        placeholder="例如：香港节点"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-region">地区</Label>
                      <Input
                        id="vps-region"
                        value={formValues.region}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, region: e.target.value }))
                        }
                        placeholder="例如：香港 / 日本 / 洛杉矶"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-provider">服务商</Label>
                      <Input
                        id="vps-provider"
                        value={formValues.provider}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, provider: e.target.value }))
                        }
                        placeholder="例如：Example Cloud"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-expiresAt">到期日期（YYYY-MM-DD） *</Label>
                      <Input
                        id="vps-expiresAt"
                        value={formValues.expiresAt}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, expiresAt: e.target.value }))
                        }
                        placeholder="2026-12-31"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-ip">IP 地址</Label>
                      <Input
                        id="vps-ip"
                        value={formValues.ip}
                        onChange={(e) => setFormValues((prev) => ({ ...prev, ip: e.target.value }))}
                        placeholder="例如：192.0.2.10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-monthlyTrafficGB">月流量（GB）</Label>
                      <Input
                        id="vps-monthlyTrafficGB"
                        type="number"
                        step="any"
                        min="0"
                        value={formValues.monthlyTrafficGB}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, monthlyTrafficGB: e.target.value }))
                        }
                        placeholder="例如：1000"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-role">用途</Label>
                      <Input
                        id="vps-role"
                        value={formValues.role}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, role: e.target.value }))
                        }
                        placeholder="例如：主面板/主线路"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-price">价格</Label>
                      <Input
                        id="vps-price"
                        type="number"
                        step="any"
                        min="0"
                        value={formValues.price}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, price: e.target.value }))
                        }
                        placeholder="例如：39.9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vps-currency">币种</Label>
                      <Input
                        id="vps-currency"
                        value={formValues.currency}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, currency: e.target.value }))
                        }
                        placeholder="CNY / USD"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                      <Label htmlFor="vps-renewUrl">续费链接</Label>
                      <Input
                        id="vps-renewUrl"
                        value={formValues.renewUrl}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, renewUrl: e.target.value }))
                        }
                        placeholder="https://billing.example.com/..."
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="vps-note">备注</Label>
                    <Input
                      id="vps-note"
                      value={formValues.note}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, note: e.target.value }))}
                      placeholder="可选备注信息"
                    />
                  </div>

                  {formError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {formError}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" size="sm" disabled={saving}>
                      {saving ? '保存中...' : '保存'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={closeForm}
                      disabled={saving}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {currentData.servers.length === 0 ? (
            <EmptyState
              title="暂无 VPS 记录"
              description={
                isReadonly
                  ? '当前 VPS 清单为空，且处于只读模式。'
                  : '点击右上角“新增 VPS”添加第一台云服务器到期提醒。'
              }
              icon={Server}
              action={
                !isReadonly ? (
                  <Button type="button" size="sm" onClick={openAddForm}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>新增 VPS</span>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {currentData.servers.map((server, index) => {
                const badge = getLevelBadgeProps(server);
                const panelStyles = getCountdownPanelStyles(server);
                const cardTitle = formatVpsCardTitle(server.name, server.region);
                const trafficLabel = formatMonthlyTraffic(server.monthlyTrafficGB ?? null);
                const priceLabel = formatVpsPrice(server.price, server.currency);
                const roleLabel = server.role ?? null;
                const hasTags = Boolean(trafficLabel || priceLabel || roleLabel);
                const isConfirmingDelete = confirmDeleteId === server.id;
                const isIpRevealed = Boolean(revealedIpIds[server.id]);
                const isNoteExpanded = Boolean(expandedNoteIds[server.id]);
                const longNote = isLongNote(server.note);

                return (
                  <Card key={server.id} className="flex min-w-0 flex-col justify-between">
                    <CardHeader className="space-y-3 pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Server className="size-4" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <CardTitle className="break-words text-base leading-snug">
                              {cardTitle}
                            </CardTitle>
                            {server.provider ? (
                              <CardDescription className="mt-1 truncate">
                                {server.provider}
                              </CardDescription>
                            ) : null}
                          </div>
                        </div>

                        {!isReadonly ? (
                          <div className="flex shrink-0 items-center gap-1">
                            {isConfirmingDelete ? (
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
                                  aria-label={`编辑 ${server.name}`}
                                  onClick={() => openEditForm(index, server)}
                                  disabled={saving}
                                >
                                  <Pencil className="size-3.5" aria-hidden="true" />
                                  <span>编辑</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`删除 ${server.name}`}
                                  onClick={() => setConfirmDeleteId(server.id)}
                                  disabled={saving}
                                >
                                  <Trash2 className="size-3.5" aria-hidden="true" />
                                  <span>删除</span>
                                </Button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-1 flex-col gap-3.5">
                      <div
                        className={cn('rounded-lg border px-3.5 py-3', panelStyles.containerClass)}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-baseline">
                              {server.error || server.daysLeft === null || server.level === null ? (
                                <span
                                  className={cn(
                                    'text-2xl font-bold tracking-tight',
                                    panelStyles.accentClass,
                                  )}
                                >
                                  异常
                                </span>
                              ) : server.daysLeft < 0 ? (
                                <>
                                  <span
                                    className={cn(
                                      'text-2xl font-bold tracking-tight tabular-nums',
                                      panelStyles.accentClass,
                                    )}
                                  >
                                    {Math.abs(server.daysLeft)}
                                  </span>
                                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                                    天前到期
                                  </span>
                                </>
                              ) : server.daysLeft === 0 ? (
                                <>
                                  <span
                                    className={cn(
                                      'text-2xl font-bold tracking-tight tabular-nums',
                                      panelStyles.accentClass,
                                    )}
                                  >
                                    0
                                  </span>
                                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                                    天（今日）
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span
                                    className={cn(
                                      'text-2xl font-bold tracking-tight tabular-nums',
                                      panelStyles.accentClass,
                                    )}
                                  >
                                    {server.daysLeft}
                                  </span>
                                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                                    天
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                              到期日：{server.expiresAt || '—'}
                            </p>
                          </div>

                          <StatusBadge status={badge.status} label={badge.label} />
                        </div>

                        {server.error ? (
                          <p className="mt-1.5 text-xs text-destructive">{server.error}</p>
                        ) : null}
                      </div>

                      {hasTags ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {trafficLabel ? (
                            <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground">
                              {trafficLabel}
                            </span>
                          ) : null}
                          {priceLabel ? (
                            <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground">
                              {priceLabel}
                            </span>
                          ) : null}
                          {roleLabel ? (
                            <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground">
                              {roleLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {server.ip ? (
                        <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-xs">
                          <span className="shrink-0 text-muted-foreground">IP</span>
                          <button
                            type="button"
                            onClick={() => toggleIpReveal(server.id)}
                            aria-label={isIpRevealed ? '隐藏 IP' : '显示 IP'}
                            aria-pressed={isIpRevealed}
                            className="inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 font-mono text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <span className={isIpRevealed ? 'break-all text-right' : 'truncate'}>
                              {isIpRevealed ? server.ip : maskIpAddress(server.ip)}
                            </span>
                            {isIpRevealed ? (
                              <EyeOff
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            ) : (
                              <Eye
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        </div>
                      ) : null}

                      {server.note ? (
                        longNote ? (
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => toggleNoteExpand(server.id)}
                              aria-expanded={isNoteExpanded}
                              className="inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <span>{isNoteExpanded ? '收起详情' : '详情'}</span>
                              {isNoteExpanded ? (
                                <ChevronUp className="size-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronDown className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                            {isNoteExpanded ? (
                              <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                                {server.note}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-xs leading-relaxed break-words text-muted-foreground">
                            {server.note}
                          </p>
                        )
                      ) : null}

                      {server.renewUrl ? (
                        <div className="mt-auto pt-1">
                          <a
                            href={server.renewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <span>前往续费</span>
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </a>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default VpsPage;
