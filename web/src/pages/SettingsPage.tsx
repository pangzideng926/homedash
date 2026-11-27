import { useCallback, useState } from 'react';
import { CheckCircle2, PlugZap, RotateCw, Save, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApi } from '@/hooks/useApi';
import {
  fetchIntegrations,
  fetchSettingsStatus,
  saveIntegrationModule,
  testIntegrationModule,
  type IntegrationFieldSource,
  type IntegrationModuleName,
  type IntegrationsViewResponse,
  type IntegrationTestResponse,
} from '@/lib/api';

interface NasFormState {
  host: string;
  port: string;
  user: string;
  keyPath: string;
}

interface QbitFormState {
  url: string;
  username: string;
  password: string;
  clearPassword: boolean;
}

interface MoviepilotFormState {
  url: string;
  apiToken: string;
  clearApiToken: boolean;
}

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
    candidate.modules &&
    candidate.modules.nas?.fields &&
    candidate.modules.qbittorrent?.fields &&
    candidate.modules.moviepilot?.fields,
  );
}

function EnvManagedBadge({ source }: { source: IntegrationFieldSource }) {
  if (source !== 'env') return null;
  return <StatusBadge status="info" label="由 .env 管理" showDot={false} />;
}

export function SettingsPage() {
  const [nasForm, setNasForm] = useState<NasFormState>({
    host: '',
    port: '22',
    user: '',
    keyPath: '',
  });
  const [qbitForm, setQbitForm] = useState<QbitFormState>({
    url: '',
    username: '',
    password: '',
    clearPassword: false,
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
      const qbitFields = res.modules.qbittorrent.fields;
      setQbitForm({
        url: qbitFields.url.value ?? '',
        username: qbitFields.username.value ?? '',
        password: '',
        clearPassword: false,
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

  const [feedback, setFeedback] = useState<Record<IntegrationModuleName, ModuleActionFeedback>>({
    nas: {},
    qbittorrent: {},
    moviepilot: {},
  });

  const setModuleFeedback = (mod: IntegrationModuleName, patch: Partial<ModuleActionFeedback>) => {
    setFeedback((prev) => ({
      ...prev,
      [mod]: { ...prev[mod], ...patch },
    }));
  };

  const handleRefreshAll = () => {
    void statusApi.refetch();
    void integrationsApi.refetch();
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

  const buildQbitPayload = (): Record<string, unknown> => {
    const fields = integrationsApi.data?.modules.qbittorrent.fields;
    const payload: Record<string, unknown> = {};
    if (fields?.url.source !== 'env') payload.url = qbitForm.url;
    if (fields?.username.source !== 'env') payload.username = qbitForm.username;
    if (fields?.password.source !== 'env') {
      if (qbitForm.clearPassword) {
        payload.password = null;
      } else if (qbitForm.password.length > 0) {
        payload.password = qbitForm.password;
      }
    }
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

  const handleSave = async (moduleName: IntegrationModuleName) => {
    setModuleFeedback(moduleName, {
      saving: true,
      saveSuccess: undefined,
      saveError: undefined,
    });

    const payload =
      moduleName === 'nas'
        ? buildNasPayload()
        : moduleName === 'qbittorrent'
          ? buildQbitPayload()
          : buildMpPayload();

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

  const handleTest = async (moduleName: IntegrationModuleName) => {
    setModuleFeedback(moduleName, {
      testing: true,
      testResult: undefined,
    });

    const payload =
      moduleName === 'nas'
        ? buildNasPayload()
        : moduleName === 'qbittorrent'
          ? buildQbitPayload()
          : buildMpPayload();

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

  const modules = statusApi.data ? Object.values(statusApi.data.modules) : [];
  const integrations = integrationsApi.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title="设置"
        description="管理服务集成凭据（敏感字段经 AES-256-GCM 加密存储）并查看环境变量配置状态。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={statusApi.loading || integrationsApi.loading}
          >
            <RotateCw
              className={
                statusApi.loading || integrationsApi.loading ? 'size-4 animate-spin' : 'size-4'
              }
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        }
      />

      {/* 集成配置区 */}
      {integrations || integrationsApi.error ? (
        <section aria-labelledby="integrations-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="integrations-heading" className="text-lg font-semibold text-foreground">
                集成配置
              </h2>
              <p className="text-sm text-muted-foreground">
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
            <div className="grid gap-4 lg:grid-cols-3">
              {/* NAS 集成卡片 */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
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
                    <div className="flex items-center justify-between gap-2">
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
                    <div className="flex items-center justify-between gap-2">
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
                    <div className="flex items-center justify-between gap-2">
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
                    <div className="flex items-center justify-between gap-2">
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

                  <div className="flex items-center gap-2 pt-1">
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

              {/* qBittorrent 集成卡片 */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">qBittorrent</CardTitle>
                    <StatusBadge
                      status={
                        integrations.modules.qbittorrent.configured ? 'configured' : 'unconfigured'
                      }
                      label={integrations.modules.qbittorrent.configured ? '已配置' : '未配置'}
                    />
                  </div>
                  <CardDescription>qBittorrent WebUI v2 只读监控连接配置。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="qbit-url">WebUI 地址</Label>
                      <EnvManagedBadge
                        source={integrations.modules.qbittorrent.fields.url.source}
                      />
                    </div>
                    <Input
                      id="qbit-url"
                      value={qbitForm.url}
                      placeholder="例如 http://192.0.2.10:8080"
                      readOnly={integrations.modules.qbittorrent.fields.url.source === 'env'}
                      disabled={integrations.modules.qbittorrent.fields.url.source === 'env'}
                      onChange={(e) => setQbitForm((prev) => ({ ...prev, url: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="qbit-username">用户名</Label>
                      <EnvManagedBadge
                        source={integrations.modules.qbittorrent.fields.username.source}
                      />
                    </div>
                    <Input
                      id="qbit-username"
                      value={qbitForm.username}
                      placeholder="例如 demo"
                      readOnly={integrations.modules.qbittorrent.fields.username.source === 'env'}
                      disabled={integrations.modules.qbittorrent.fields.username.source === 'env'}
                      onChange={(e) =>
                        setQbitForm((prev) => ({ ...prev, username: e.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="qbit-password">密码</Label>
                      <div className="flex items-center gap-1.5">
                        <EnvManagedBadge
                          source={integrations.modules.qbittorrent.fields.password.source}
                        />
                        {integrations.modules.qbittorrent.fields.password.source !== 'env' &&
                        (integrations.modules.qbittorrent.fields.password.set ||
                          qbitForm.clearPassword) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            aria-label={
                              qbitForm.clearPassword
                                ? '取消清除 qBittorrent 密码'
                                : '清除 qBittorrent 密码'
                            }
                            onClick={() =>
                              setQbitForm((prev) => ({
                                ...prev,
                                password: '',
                                clearPassword: !prev.clearPassword,
                              }))
                            }
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                            <span>{qbitForm.clearPassword ? '取消清除' : '清除'}</span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <Input
                      id="qbit-password"
                      type="password"
                      value={qbitForm.password}
                      placeholder={
                        qbitForm.clearPassword
                          ? '已标记清除，保存后生效'
                          : integrations.modules.qbittorrent.fields.password.set
                            ? '已设置（留空则不修改）'
                            : '未设置'
                      }
                      readOnly={integrations.modules.qbittorrent.fields.password.source === 'env'}
                      disabled={integrations.modules.qbittorrent.fields.password.source === 'env'}
                      onChange={(e) =>
                        setQbitForm((prev) => ({
                          ...prev,
                          password: e.target.value,
                          clearPassword: false,
                        }))
                      }
                    />
                  </div>

                  <IntegrationFeedbackBanner feedback={feedback.qbittorrent} />

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={feedback.qbittorrent.testing}
                      onClick={() => void handleTest('qbittorrent')}
                    >
                      <PlugZap className="size-3.5" aria-hidden="true" />
                      <span>{feedback.qbittorrent.testing ? '测试中...' : '测试连接'}</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={feedback.qbittorrent.saving}
                      onClick={() => void handleSave('qbittorrent')}
                    >
                      <Save className="size-3.5" aria-hidden="true" />
                      <span>{feedback.qbittorrent.saving ? '保存中...' : '保存'}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* MoviePilot 集成卡片 */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
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
                    <div className="flex items-center justify-between gap-2">
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
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="mp-apiToken">API 令牌</Label>
                      <div className="flex items-center gap-1.5">
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

                  <div className="flex items-center gap-2 pt-1">
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
