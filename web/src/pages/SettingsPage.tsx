import { useCallback, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Pencil,
  PlugZap,
  Plus,
  RotateCw,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import {
  DownloaderTagBadge,
  DownloaderTypeBadge,
} from '@/components/downloaders/downloader-badges';
import {
  DOWNLOADER_TAG_OPTIONS,
  getDownloaderTypeFullName,
} from '@/components/downloaders/downloader-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApi } from '@/hooks/useApi';
import {
  fetchDownloaders,
  fetchIntegrations,
  fetchSettingsStatus,
  saveDownloaders,
  saveIntegrationModule,
  testDownloaderConnection,
  testIntegrationModule,
  type DownloaderInput,
  type DownloaderPublicConfig,
  type DownloadersListResponse,
  type DownloaderTag,
  type DownloaderTestResponse,
  type DownloaderType,
  type IntegrationFieldSource,
  type IntegrationsViewResponse,
  type IntegrationTestResponse,
} from '@/lib/api';
import {
  STATUS_REFRESH_OPTIONS,
  parseStatusRefreshInterval,
  readStatusRefreshInterval,
  writeStatusRefreshInterval,
  type StatusRefreshIntervalSeconds,
} from '@/lib/status-refresh';

type EditableIntegrationModule = 'nas' | 'moviepilot';

interface NasFormState {
  host: string;
  port: string;
  user: string;
  keyPath: string;
}

interface MoviepilotFormState {
  url: string;
  apiToken: string;
  clearApiToken: boolean;
}

interface DownloaderFormState {
  id?: string;
  name: string;
  type: DownloaderType;
  url: string;
  username: string;
  password: string;
  passwordSet: boolean;
  clearPassword: boolean;
  tags: DownloaderTag[];
  enabled: boolean;
}

const EMPTY_DOWNLOADER_FORM: DownloaderFormState = {
  name: '',
  type: 'qbittorrent',
  url: '',
  username: '',
  password: '',
  passwordSet: false,
  clearPassword: false,
  tags: [],
  enabled: true,
};

interface ModuleActionFeedback {
  saving?: boolean;
  testing?: boolean;
  saveSuccess?: string;
  saveError?: string;
  testResult?: IntegrationTestResponse;
}

function isValidIntegrationsResponse(data: unknown): data is IntegrationsViewResponse {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Partial<IntegrationsViewResponse>;
  return Boolean(
    candidate.modules && candidate.modules.nas?.fields && candidate.modules.moviepilot?.fields,
  );
}

function isValidDownloadersResponse(data: unknown): data is DownloadersListResponse {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Partial<DownloadersListResponse>;
  return Array.isArray(candidate.downloaders);
}

function EnvManagedBadge({ source }: { source: IntegrationFieldSource }) {
  if (source !== 'env') return null;
  return <StatusBadge status="info" label="由 .env 管理" showDot={false} />;
}

function toDownloaderInput(item: DownloaderPublicConfig): DownloaderInput {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    url: item.url,
    username: item.username,
    tags: [...item.tags],
    enabled: item.enabled,
  };
}

export function SettingsPage() {
  const [statusRefreshInterval, setStatusRefreshInterval] =
    useState<StatusRefreshIntervalSeconds>(readStatusRefreshInterval);
  const [nasForm, setNasForm] = useState<NasFormState>({
    host: '',
    port: '22',
    user: '',
    keyPath: '',
  });
  const [mpForm, setMpForm] = useState<MoviepilotFormState>({
    url: '',
    apiToken: '',
    clearApiToken: false,
  });

  const statusApi = useApi(fetchSettingsStatus);

  const integrationsFetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetchIntegrations(signal);
    if (!isValidIntegrationsResponse(res)) {
      return null;
    }
    if (!signal.aborted) {
      const nasFields = res.modules.nas.fields;
      setNasForm({
        host: nasFields.host.value ?? '',
        port: nasFields.port.value !== undefined ? String(nasFields.port.value) : '',
        user: nasFields.user.value ?? '',
        keyPath: nasFields.keyPath.value ?? '',
      });
      const mpFields = res.modules.moviepilot.fields;
      setMpForm({
        url: mpFields.url.value ?? '',
        apiToken: '',
        clearApiToken: false,
      });
    }
    return res;
  }, []);
  const integrationsApi = useApi(integrationsFetcher);

  const downloadersFetcher = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetchDownloaders(signal);
      return isValidDownloadersResponse(res) ? res : null;
    } catch {
      return null;
    }
  }, []);
  const downloadersApi = useApi(downloadersFetcher);

  const [feedback, setFeedback] = useState<Record<EditableIntegrationModule, ModuleActionFeedback>>(
    {
      nas: {},
      moviepilot: {},
    },
  );

  // 下载器表单与交互状态
  const [dlFormOpen, setDlFormOpen] = useState(false);
  const [dlForm, setDlForm] = useState<DownloaderFormState>(EMPTY_DOWNLOADER_FORM);
  const [dlFormError, setDlFormError] = useState<string | null>(null);
  const [dlSaving, setDlSaving] = useState(false);
  const [dlTestingForm, setDlTestingForm] = useState(false);
  const [dlFormTestResult, setDlFormTestResult] = useState<DownloaderTestResponse | null>(null);
  const [dlActionFeedback, setDlActionFeedback] = useState<{
    success?: string;
    error?: string;
  }>({});
  const [dlTestingIds, setDlTestingIds] = useState<Record<string, boolean>>({});
  const [dlTestResultsById, setDlTestResultsById] = useState<
    Record<string, DownloaderTestResponse>
  >({});
  const [dlConfirmDeleteId, setDlConfirmDeleteId] = useState<string | null>(null);

  const setModuleFeedback = (
    mod: EditableIntegrationModule,
    patch: Partial<ModuleActionFeedback>,
  ) => {
    setFeedback((prev) => ({
      ...prev,
      [mod]: { ...prev[mod], ...patch },
    }));
  };

  const handleRefreshAll = () => {
    void statusApi.refetch();
    void integrationsApi.refetch();
    void downloadersApi.refetch();
  };

  const buildNasPayload = (): Record<string, unknown> => {
    const fields = integrationsApi.data?.modules.nas.fields;
    const payload: Record<string, unknown> = {};
    if (fields?.host.source !== 'env') payload.host = nasForm.host;
    if (fields?.port.source !== 'env') payload.port = nasForm.port;
    if (fields?.user.source !== 'env') payload.user = nasForm.user;
    if (fields?.keyPath.source !== 'env') payload.keyPath = nasForm.keyPath;
    return payload;
  };

  const buildMpPayload = (): Record<string, unknown> => {
    const fields = integrationsApi.data?.modules.moviepilot.fields;
    const payload: Record<string, unknown> = {};
    if (fields?.url.source !== 'env') payload.url = mpForm.url;
    if (fields?.apiToken.source !== 'env') {
      if (mpForm.clearApiToken) {
        payload.apiToken = null;
      } else if (mpForm.apiToken.length > 0) {
        payload.apiToken = mpForm.apiToken;
      }
    }
    return payload;
  };

  const handleSave = async (moduleName: EditableIntegrationModule) => {
    setModuleFeedback(moduleName, {
      saving: true,
      saveSuccess: undefined,
      saveError: undefined,
    });

    const payload = moduleName === 'nas' ? buildNasPayload() : buildMpPayload();

    try {
      await saveIntegrationModule(moduleName, payload);
      setModuleFeedback(moduleName, {
        saving: false,
        saveSuccess: '已加密保存配置',
        saveError: undefined,
      });
      await Promise.all([integrationsApi.refetch(), statusApi.refetch()]);
    } catch (err) {
      setModuleFeedback(moduleName, {
        saving: false,
        saveSuccess: undefined,
        saveError: err instanceof Error ? err.message : '保存失败',
      });
    }
  };

  const handleTest = async (moduleName: EditableIntegrationModule) => {
    setModuleFeedback(moduleName, {
      testing: true,
      testResult: undefined,
    });

    const payload = moduleName === 'nas' ? buildNasPayload() : buildMpPayload();

    try {
      const result = await testIntegrationModule(moduleName, payload);
      setModuleFeedback(moduleName, {
        testing: false,
        testResult: result,
      });
    } catch (err) {
      setModuleFeedback(moduleName, {
        testing: false,
        testResult: {
          ok: false,
          durationMs: 0,
          error: err instanceof Error ? err.message : '测试请求失败',
        },
      });
    }
  };

  const openAddDownloaderForm = () => {
    setDlForm(EMPTY_DOWNLOADER_FORM);
    setDlFormError(null);
    setDlFormTestResult(null);
    setDlFormOpen(true);
  };

  const openEditDownloaderForm = (item: DownloaderPublicConfig) => {
    setDlForm({
      id: item.id,
      name: item.name,
      type: item.type,
      url: item.url,
      username: item.username,
      password: '',
      passwordSet: item.passwordSet,
      clearPassword: false,
      tags: [...item.tags],
      enabled: item.enabled,
    });
    setDlFormError(null);
    setDlFormTestResult(null);
    setDlFormOpen(true);
  };

  const toggleFormTag = (tag: DownloaderTag) => {
    setDlForm((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
    }));
  };

  const handleSaveDownloaderForm = async (event: FormEvent) => {
    event.preventDefault();
    setDlFormError(null);
    setDlActionFeedback({});

    const trimmedName = dlForm.name.trim();
    const trimmedUrl = dlForm.url.trim();
    if (!trimmedName) {
      setDlFormError('请输入实例名称');
      return;
    }
    if (!trimmedUrl) {
      setDlFormError('请输入下载器地址');
      return;
    }

    const currentEditable = (downloadersApi.data?.downloaders ?? []).filter(
      (item) => !item.readonly && item.source === 'file',
    );
    const nextPayload: DownloaderInput[] = currentEditable.map(toDownloaderInput);

    const editedRecord: DownloaderInput = {
      ...(dlForm.id ? { id: dlForm.id } : {}),
      name: trimmedName,
      type: dlForm.type,
      url: trimmedUrl,
      username: dlForm.username.trim(),
      tags: dlForm.tags,
      enabled: dlForm.enabled,
      ...(dlForm.clearPassword
        ? { password: null }
        : dlForm.password.length > 0
          ? { password: dlForm.password }
          : {}),
    };

    if (dlForm.id) {
      const idx = nextPayload.findIndex((item) => item.id === dlForm.id);
      if (idx >= 0) {
        nextPayload[idx] = editedRecord;
      } else {
        nextPayload.push(editedRecord);
      }
    } else {
      nextPayload.push(editedRecord);
    }

    setDlSaving(true);
    try {
      await saveDownloaders(nextPayload);
      setDlFormOpen(false);
      setDlActionFeedback({ success: '已加密保存下载器配置' });
      await Promise.all([downloadersApi.refetch(), statusApi.refetch()]);
    } catch (err) {
      setDlFormError(err instanceof Error ? err.message : '保存下载器失败');
    } finally {
      setDlSaving(false);
    }
  };

  const handleDeleteDownloader = async (targetId: string) => {
    setDlActionFeedback({});
    const nextPayload = (downloadersApi.data?.downloaders ?? [])
      .filter((item) => !item.readonly && item.source === 'file' && item.id !== targetId)
      .map(toDownloaderInput);

    setDlSaving(true);
    try {
      await saveDownloaders(nextPayload);
      setDlConfirmDeleteId(null);
      if (dlForm.id === targetId) {
        setDlFormOpen(false);
      }
      setDlActionFeedback({ success: '已移除下载器实例并保存' });
      await Promise.all([downloadersApi.refetch(), statusApi.refetch()]);
    } catch (err) {
      setDlActionFeedback({ error: err instanceof Error ? err.message : '删除下载器失败' });
    } finally {
      setDlSaving(false);
    }
  };

  const handleTestDownloaderItem = async (item: DownloaderPublicConfig) => {
    setDlTestingIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      const res = await testDownloaderConnection({
        id: item.id,
        type: item.type,
        url: item.url,
        username: item.username,
      });
      setDlTestResultsById((prev) => ({ ...prev, [item.id]: res }));
    } catch (err) {
      setDlTestResultsById((prev) => ({
        ...prev,
        [item.id]: {
          ok: false,
          type: item.type,
          durationMs: 0,
          error: err instanceof Error ? err.message : '测试请求失败',
        },
      }));
    } finally {
      setDlTestingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleTestDownloaderForm = async () => {
    setDlFormTestResult(null);
    setDlTestingForm(true);
    try {
      const res = await testDownloaderConnection({
        ...(dlForm.id ? { id: dlForm.id } : {}),
        type: dlForm.type,
        url: dlForm.url.trim(),
        username: dlForm.username.trim(),
        ...(dlForm.password ? { password: dlForm.password } : {}),
      });
      setDlFormTestResult(res);
    } catch (err) {
      setDlFormTestResult({
        ok: false,
        type: dlForm.type,
        durationMs: 0,
        error: err instanceof Error ? err.message : '测试请求失败',
      });
    } finally {
      setDlTestingForm(false);
    }
  };

  const handleStatusRefreshIntervalChange = (rawValue: string) => {
    const next = parseStatusRefreshInterval(rawValue);
    setStatusRefreshInterval(next);
    writeStatusRefreshInterval(next);
  };

  const modules = statusApi.data ? Object.values(statusApi.data.modules) : [];
  const integrations = integrationsApi.data;
  const downloadersData = downloadersApi.data;
  const downloaderList = downloadersData?.downloaders ?? [];

  return (
    <div className="min-w-0 space-y-8">
      <PageHeader
        title="设置"
        description="管理服务集成凭据（敏感字段经 AES-256-GCM 加密存储）并查看环境变量配置状态。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={statusApi.loading || integrationsApi.loading || downloadersApi.loading}
          >
            <RotateCw
              className={
                statusApi.loading || integrationsApi.loading || downloadersApi.loading
                  ? 'size-4 animate-spin'
                  : 'size-4'
              }
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        }
      />

      {/* 前端偏好设置区 */}
      <section aria-labelledby="preferences-heading" className="min-w-0 space-y-4">
        <div className="min-w-0">
          <h2 id="preferences-heading" className="text-lg font-semibold text-foreground">
            前端偏好设置
          </h2>
          <p className="text-sm text-muted-foreground">
            仅保存在当前浏览器本地，不影响服务端环境变量或集成凭据文件。
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">自动刷新策略</CardTitle>
              <StatusBadge status="info" label="本地浏览器偏好" showDot={false} />
            </div>
            <CardDescription>
              仅作用于家用设备页、NAS 状态页及首页总览的设备与 NAS
              区块；定时刷新优先使用服务端缓存，手动点击刷新才强制重新采集。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex min-w-0 flex-col gap-2 sm:max-w-xs">
              <Label htmlFor="status-refresh-interval">状态刷新间隔</Label>
              <select
                id="status-refresh-interval"
                value={String(statusRefreshInterval)}
                onChange={(e) => handleStatusRefreshIntervalChange(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {STATUS_REFRESH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 集成配置区 */}
      {integrations || downloadersData || integrationsApi.error ? (
        <section aria-labelledby="integrations-heading" className="min-w-0 space-y-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 id="integrations-heading" className="text-lg font-semibold text-foreground">
                集成配置
              </h2>
              <p className="break-words text-sm text-muted-foreground">
                密码与 API 令牌在服务端加密存储，界面仅显示“已设置”或“未设置”；若已在 .env
                中配置则以 .env 为准。
              </p>
            </div>
            {integrations ? (
              <StatusBadge
                status={integrations.fileConfigured ? 'success' : 'warning'}
                label={integrations.fileConfigured ? '凭据文件已启用' : '未配置 INTEGRATIONS_FILE'}
              />
            ) : null}
          </div>

          {integrations && !integrations.fileConfigured ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                当前未设置 <code>INTEGRATIONS_FILE</code> 环境变量，界面保存功能不可用；你仍可通过
                .env 管理配置，或填写参数进行连接测试。
              </span>
            </div>
          ) : null}

          {integrationsApi.error ? (
            <ErrorState
              title="获取集成配置失败"
              message={integrationsApi.error.message}
              onRetry={() => void integrationsApi.refetch()}
            />
          ) : integrations ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* NAS 集成卡片 */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">NAS（SSH 只读）</CardTitle>
                    <StatusBadge
                      status={integrations.modules.nas.configured ? 'configured' : 'unconfigured'}
                      label={integrations.modules.nas.configured ? '已配置' : '未配置'}
                    />
                  </div>
                  <CardDescription>
                    仅填写服务器上 SSH 私钥路径，系统绝不上传、不读取也不展示私钥内容。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="nas-host">主机地址</Label>
                      <EnvManagedBadge source={integrations.modules.nas.fields.host.source} />
                    </div>
                    <Input
                      id="nas-host"
                      value={nasForm.host}
                      placeholder="例如 192.0.2.10 或 nas.example.com"
                      readOnly={integrations.modules.nas.fields.host.source === 'env'}
                      disabled={integrations.modules.nas.fields.host.source === 'env'}
                      onChange={(e) => setNasForm((prev) => ({ ...prev, host: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="nas-port">SSH 端口</Label>
                      <EnvManagedBadge source={integrations.modules.nas.fields.port.source} />
                    </div>
                    <Input
                      id="nas-port"
                      value={nasForm.port}
                      placeholder="默认 22"
                      readOnly={integrations.modules.nas.fields.port.source === 'env'}
                      disabled={integrations.modules.nas.fields.port.source === 'env'}
                      onChange={(e) => setNasForm((prev) => ({ ...prev, port: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="nas-user">SSH 用户名</Label>
                      <EnvManagedBadge source={integrations.modules.nas.fields.user.source} />
                    </div>
                    <Input
                      id="nas-user"
                      value={nasForm.user}
                      placeholder="例如 demo"
                      readOnly={integrations.modules.nas.fields.user.source === 'env'}
                      disabled={integrations.modules.nas.fields.user.source === 'env'}
                      onChange={(e) => setNasForm((prev) => ({ ...prev, user: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="nas-keyPath">私钥路径</Label>
                      <EnvManagedBadge source={integrations.modules.nas.fields.keyPath.source} />
                    </div>
                    <Input
                      id="nas-keyPath"
                      value={nasForm.keyPath}
                      placeholder="例如 ./secrets/nas_id_ed25519"
                      readOnly={integrations.modules.nas.fields.keyPath.source === 'env'}
                      disabled={integrations.modules.nas.fields.keyPath.source === 'env'}
                      onChange={(e) => setNasForm((prev) => ({ ...prev, keyPath: e.target.value }))}
                    />
                  </div>

                  <IntegrationFeedbackBanner feedback={feedback.nas} />

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={feedback.nas.testing}
                      onClick={() => void handleTest('nas')}
                    >
                      <PlugZap className="size-3.5" aria-hidden="true" />
                      <span>{feedback.nas.testing ? '测试中...' : '测试连接'}</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={feedback.nas.saving}
                      onClick={() => void handleSave('nas')}
                    >
                      <Save className="size-3.5" aria-hidden="true" />
                      <span>{feedback.nas.saving ? '保存中...' : '保存'}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* MoviePilot 集成卡片 */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">MoviePilot</CardTitle>
                    <StatusBadge
                      status={
                        integrations.modules.moviepilot.configured ? 'configured' : 'unconfigured'
                      }
                      label={integrations.modules.moviepilot.configured ? '已配置' : '未配置'}
                    />
                  </div>
                  <CardDescription>MoviePilot v3 API 只读连接配置（X-API-KEY）。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="mp-url">服务地址</Label>
                      <EnvManagedBadge source={integrations.modules.moviepilot.fields.url.source} />
                    </div>
                    <Input
                      id="mp-url"
                      value={mpForm.url}
                      placeholder="例如 https://moviepilot.example.com"
                      readOnly={integrations.modules.moviepilot.fields.url.source === 'env'}
                      disabled={integrations.modules.moviepilot.fields.url.source === 'env'}
                      onChange={(e) => setMpForm((prev) => ({ ...prev, url: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="mp-apiToken">API 令牌</Label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EnvManagedBadge
                          source={integrations.modules.moviepilot.fields.apiToken.source}
                        />
                        {integrations.modules.moviepilot.fields.apiToken.source !== 'env' &&
                        (integrations.modules.moviepilot.fields.apiToken.set ||
                          mpForm.clearApiToken) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            aria-label={
                              mpForm.clearApiToken
                                ? '取消清除 MoviePilot 令牌'
                                : '清除 MoviePilot 令牌'
                            }
                            onClick={() =>
                              setMpForm((prev) => ({
                                ...prev,
                                apiToken: '',
                                clearApiToken: !prev.clearApiToken,
                              }))
                            }
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                            <span>{mpForm.clearApiToken ? '取消清除' : '清除'}</span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <Input
                      id="mp-apiToken"
                      type="password"
                      value={mpForm.apiToken}
                      placeholder={
                        mpForm.clearApiToken
                          ? '已标记清除，保存后生效'
                          : integrations.modules.moviepilot.fields.apiToken.set
                            ? '已设置（留空则不修改）'
                            : '未设置'
                      }
                      readOnly={integrations.modules.moviepilot.fields.apiToken.source === 'env'}
                      disabled={integrations.modules.moviepilot.fields.apiToken.source === 'env'}
                      onChange={(e) =>
                        setMpForm((prev) => ({
                          ...prev,
                          apiToken: e.target.value,
                          clearApiToken: false,
                        }))
                      }
                    />
                  </div>

                  <IntegrationFeedbackBanner feedback={feedback.moviepilot} />

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={feedback.moviepilot.testing}
                      onClick={() => void handleTest('moviepilot')}
                    >
                      <PlugZap className="size-3.5" aria-hidden="true" />
                      <span>{feedback.moviepilot.testing ? '测试中...' : '测试连接'}</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={feedback.moviepilot.saving}
                      onClick={() => void handleSave('moviepilot')}
                    >
                      <Save className="size-3.5" aria-hidden="true" />
                      <span>{feedback.moviepilot.saving ? '保存中...' : '保存'}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* 多实例下载器配置卡片 */}
          {downloadersData ? (
            <Card>
              <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">下载器（qBittorrent / Transmission）</CardTitle>
                  <CardDescription>
                    支持多实例只读监控与用途标签分类；密码经 AES-256-GCM 加密存储且永不回显。
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={openAddDownloaderForm}
                  disabled={dlSaving || downloadersData.mock}
                  className="self-start sm:self-auto"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span>新增下载器</span>
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {dlActionFeedback.success ? (
                  <div
                    role="status"
                    className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"
                  >
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{dlActionFeedback.success}</span>
                  </div>
                ) : null}
                {dlActionFeedback.error ? (
                  <div
                    role="alert"
                    className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400"
                  >
                    <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{dlActionFeedback.error}</span>
                  </div>
                ) : null}

                {dlFormOpen ? (
                  <form
                    onSubmit={(e) => void handleSaveDownloaderForm(e)}
                    className="space-y-4 rounded-xl border border-border bg-muted/20 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">
                        {dlForm.id ? '编辑下载器实例' : '新增下载器实例'}
                      </h3>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="dl-name">实例名称</Label>
                        <Input
                          id="dl-name"
                          value={dlForm.name}
                          placeholder="例如 qB 下载 / TR 保种"
                          onChange={(e) => setDlForm((prev) => ({ ...prev, name: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="dl-type">下载器类型</Label>
                        <select
                          id="dl-type"
                          value={dlForm.type}
                          onChange={(e) =>
                            setDlForm((prev) => ({
                              ...prev,
                              type: e.target.value as DownloaderType,
                            }))
                          }
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="qbittorrent">qBittorrent</option>
                          <option value="transmission">Transmission</option>
                        </select>
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="dl-url">WebUI / RPC 地址</Label>
                        <Input
                          id="dl-url"
                          value={dlForm.url}
                          placeholder={
                            dlForm.type === 'qbittorrent'
                              ? '例如 http://192.0.2.10:8080'
                              : '例如 http://192.0.2.12:9091'
                          }
                          onChange={(e) => setDlForm((prev) => ({ ...prev, url: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="dl-username">用户名</Label>
                        <Input
                          id="dl-username"
                          value={dlForm.username}
                          placeholder="例如 demo（Transmission 无认证可留空）"
                          onChange={(e) =>
                            setDlForm((prev) => ({ ...prev, username: e.target.value }))
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="dl-password">密码</Label>
                          {dlForm.id && (dlForm.passwordSet || dlForm.clearPassword) ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              aria-label={
                                dlForm.clearPassword ? '取消清除下载器密码' : '清除下载器密码'
                              }
                              onClick={() =>
                                setDlForm((prev) => ({
                                  ...prev,
                                  password: '',
                                  clearPassword: !prev.clearPassword,
                                }))
                              }
                            >
                              <Trash2 className="size-3" aria-hidden="true" />
                              <span>{dlForm.clearPassword ? '取消清除' : '清除'}</span>
                            </Button>
                          ) : null}
                        </div>
                        <Input
                          id="dl-password"
                          type="password"
                          value={dlForm.password}
                          placeholder={
                            dlForm.clearPassword
                              ? '已标记清除，保存后生效'
                              : dlForm.passwordSet
                                ? '已设置（留空则不修改）'
                                : '未设置'
                          }
                          onChange={(e) =>
                            setDlForm((prev) => ({
                              ...prev,
                              password: e.target.value,
                              clearPassword: false,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium text-foreground">用途标签</span>
                        <div className="flex flex-wrap items-center gap-3">
                          {DOWNLOADER_TAG_OPTIONS.map((opt) => (
                            <label
                              key={opt.value}
                              className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
                            >
                              <input
                                type="checkbox"
                                checked={dlForm.tags.includes(opt.value)}
                                onChange={() => toggleFormTag(opt.value)}
                                className="size-3.5 rounded border-input accent-primary"
                              />
                              <span>{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                        <input
                          id="dl-enabled"
                          type="checkbox"
                          checked={dlForm.enabled}
                          onChange={(e) =>
                            setDlForm((prev) => ({ ...prev, enabled: e.target.checked }))
                          }
                          className="size-3.5 rounded border-input accent-primary"
                        />
                        <span>启用此实例</span>
                      </label>
                    </div>

                    {dlFormError ? (
                      <div
                        role="alert"
                        className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400"
                      >
                        <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
                        <span>{dlFormError}</span>
                      </div>
                    ) : null}

                    {dlFormTestResult ? (
                      <div
                        role={dlFormTestResult.ok ? 'status' : 'alert'}
                        className={
                          dlFormTestResult.ok
                            ? 'flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400'
                            : 'flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400'
                        }
                      >
                        {dlFormTestResult.ok ? (
                          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span>
                          {dlFormTestResult.ok
                            ? `${dlFormTestResult.detail ?? '连接成功'}（耗时 ${dlFormTestResult.durationMs} ms）`
                            : `${dlFormTestResult.error ?? '连接失败'}（耗时 ${dlFormTestResult.durationMs} ms）`}
                        </span>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={dlTestingForm || dlSaving}
                        onClick={() => void handleTestDownloaderForm()}
                      >
                        <PlugZap className="size-3.5" aria-hidden="true" />
                        <span>{dlTestingForm ? '测试中...' : '测试连接'}</span>
                      </Button>
                      <Button type="submit" size="sm" disabled={dlSaving}>
                        <Save className="size-3.5" aria-hidden="true" />
                        <span>{dlSaving ? '保存中...' : '保存实例'}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={dlSaving}
                        onClick={() => setDlFormOpen(false)}
                      >
                        取消
                      </Button>
                    </div>
                  </form>
                ) : null}

                {downloaderList.length === 0 ? (
                  <EmptyState
                    title="暂未配置下载器实例"
                    description="点击右上角“新增下载器”添加 qBittorrent 或 Transmission 实例。"
                  />
                ) : (
                  <div className="space-y-3">
                    {downloaderList.map((inst) => {
                      const testResult = dlTestResultsById[inst.id];
                      const testingItem = Boolean(dlTestingIds[inst.id]);
                      const confirmingDelete = dlConfirmDeleteId === inst.id;

                      return (
                        <div
                          key={inst.id}
                          className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <DownloaderTypeBadge type={inst.type} />
                                <span className="font-medium text-foreground">{inst.name}</span>
                                <StatusBadge
                                  status={inst.enabled ? 'success' : 'unknown'}
                                  label={inst.enabled ? '已启用' : '已停用'}
                                />
                                {inst.source === 'env' ? (
                                  <StatusBadge status="info" label="由 .env 管理" showDot={false} />
                                ) : null}
                                {inst.tags.map((tag) => (
                                  <DownloaderTagBadge key={tag} tag={tag} />
                                ))}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{getDownloaderTypeFullName(inst.type)}</span>
                                <span className="break-all font-mono">{inst.url}</span>
                                <span>用户名：{inst.username || '（未填）'}</span>
                                <span>密码：{inst.passwordSet ? '已设置' : '未设置'}</span>
                              </div>
                            </div>

                            <div className="flex max-w-full flex-wrap items-center gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`测试连接 ${inst.name}`}
                                disabled={testingItem || dlSaving}
                                onClick={() => void handleTestDownloaderItem(inst)}
                              >
                                <PlugZap className="size-3.5" aria-hidden="true" />
                                <span>{testingItem ? '测试中...' : '测试连接'}</span>
                              </Button>

                              {!inst.readonly ? (
                                confirmingDelete ? (
                                  <div className="inline-flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      size="sm"
                                      disabled={dlSaving}
                                      onClick={() => void handleDeleteDownloader(inst.id)}
                                    >
                                      确认删除
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={dlSaving}
                                      onClick={() => setDlConfirmDeleteId(null)}
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
                                      aria-label={`编辑 ${inst.name}`}
                                      disabled={dlSaving}
                                      onClick={() => openEditDownloaderForm(inst)}
                                    >
                                      <Pencil className="size-3.5" aria-hidden="true" />
                                      <span>编辑</span>
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`删除 ${inst.name}`}
                                      disabled={dlSaving}
                                      onClick={() => setDlConfirmDeleteId(inst.id)}
                                    >
                                      <Trash2 className="size-3.5" aria-hidden="true" />
                                      <span>删除</span>
                                    </Button>
                                  </>
                                )
                              ) : null}
                            </div>
                          </div>

                          {testResult ? (
                            <div
                              role={testResult.ok ? 'status' : 'alert'}
                              className={
                                testResult.ok
                                  ? 'flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-400'
                                  : 'flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-400'
                              }
                            >
                              {testResult.ok ? (
                                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
                              )}
                              <span>
                                {testResult.ok
                                  ? `${testResult.detail ?? '连接成功'}（耗时 ${testResult.durationMs} ms）`
                                  : `${testResult.error ?? '连接失败'}（耗时 ${testResult.durationMs} ms）`}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}

      {/* 环境变量与模块配置状态区 */}
      <section aria-labelledby="env-status-heading" className="space-y-4">
        <div>
          <h2 id="env-status-heading" className="text-lg font-semibold text-foreground">
            配置状态
          </h2>
          <p className="text-sm text-muted-foreground">
            综合环境变量与本地凭据文件展示各模块配置完整度（仅展示键是否已填写，不暴露任何值）。
          </p>
        </div>

        {statusApi.loading ? (
          <LoadingState variant="skeleton" rows={6} message="正在加载配置状态..." />
        ) : statusApi.error ? (
          <ErrorState
            title="获取配置状态失败"
            message={statusApi.error.message}
            onRetry={() => void statusApi.refetch()}
          />
        ) : modules.length === 0 ? (
          <EmptyState title="暂无配置模块" description="当前未检测到可展示的配置模块。" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((mod) => (
              <Card key={mod.id}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="text-base">{mod.label}</CardTitle>
                  <StatusBadge status={mod.status} label={mod.statusLabel} />
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {Object.entries(mod.keys).map(([key, filled]) => (
                      <li
                        key={key}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs"
                      >
                        <code className="min-w-0 truncate font-mono text-foreground">{key}</code>
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
      </section>
    </div>
  );
}

function IntegrationFeedbackBanner({ feedback }: { feedback: ModuleActionFeedback }) {
  return (
    <div className="space-y-1.5">
      {feedback.saveSuccess ? (
        <div
          role="status"
          className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-400"
        >
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{feedback.saveSuccess}</span>
        </div>
      ) : null}
      {feedback.saveError ? (
        <div
          role="alert"
          className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-400"
        >
          <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{feedback.saveError}</span>
        </div>
      ) : null}
      {feedback.testResult ? (
        <div
          role={feedback.testResult.ok ? 'status' : 'alert'}
          className={
            feedback.testResult.ok
              ? 'flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-400'
              : 'flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-400'
          }
        >
          {feedback.testResult.ok ? (
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {feedback.testResult.ok
              ? `${feedback.testResult.detail ?? '连接成功'}（耗时 ${feedback.testResult.durationMs} ms）`
              : `${feedback.testResult.error ?? '连接失败'}（耗时 ${feedback.testResult.durationMs} ms）`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default SettingsPage;
