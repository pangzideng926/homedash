# homedash

家庭服务器控制台：把家里 NAS、刷流做种、家用电脑、VPS 和各类账号告警集中到一个网页里查看。同时也是一套可复用的通用后台模板骨架。

## 规划功能

- NAS 状态与磁盘用量
- qBittorrent / MoviePilot 刷流与做种数据
- 家用 Windows 机器状态（SSH 采集）
- VPS 到期提醒
- 账号登录与安全告警汇总
- 通用后台骨架：布局、路由、登录鉴权
- NAS Docker 一键部署

## 技术栈

| 领域     | 选型                                                    | 选择理由                                                                                                          |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 前端     | React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui | React 生态成熟、组件易于复用；Vite 冷启动与构建速度快；Tailwind 与 shadcn/ui 便于快速构建一致且可定制的控制台界面 |
| 后端     | Node.js 22 + Hono                                       | 全栈统一使用 TypeScript；Hono 轻量、类型安全、Web 标准兼容，适合作为家庭控制台 API 网关与静态资源托管层           |
| 数据库   | SQLite + Drizzle ORM                                    | 家庭控制台单机低并发场景下 SQLite 零外部依赖、单文件易备份；Drizzle 类型安全且 SQL 迁移清晰可控                   |
| 测试     | Vitest                                                  | 前后端共用同一套测试框架与命令，原生支持 TypeScript 与 ESM，运行迅速                                              |
| 代码规范 | ESLint + Prettier                                       | 统一的前后端静态检查与代码格式规范，减少风格分歧与常见编码错误                                                    |
| CI       | GitHub Actions                                          | 与仓库深度集成，PR 与 `main` 分支推送自动执行检查与构建，保障主干质量                                             |
| 部署     | 单镜像 Docker 部署                                      | 生产环境由后端同端口托管前端产物，单容器即可在 NAS 或家用服务器上启动运行，运维与持久化简单                       |

## 目录结构

```text
homedash/
├── .github/workflows/ci.yml   # GitHub Actions CI 与密钥扫描工作流
├── .gitleaks.toml             # Gitleaks 密钥扫描规则配置
├── server/                    # Node.js + Hono 后端服务
│   ├── drizzle/               # Drizzle SQLite 数据库迁移文件
│   ├── src/                   # 服务端源码（config/ 分组配置、鉴权、限流、数据库、路由）
│   ├── test/                  # 后端单元测试
│   ├── drizzle.config.ts      # Drizzle Kit 配置
│   └── package.json
├── web/                       # React + Vite 前端应用
│   ├── src/                   # 前端源码
│   │   ├── shell/             # 通用后台骨架（布局、导航树、主题、鉴权与路由，与业务解耦）
│   │   ├── components/
│   │   │   ├── common/        # 通用业务无关 UI 组件（DataCard、StatusBadge 等）
│   │   │   └── ui/            # shadcn/ui 基础组件
│   │   ├── config/            # 菜单与路由集中配置（navigation.ts）
│   │   ├── hooks/             # 通用请求 Hook（useApi）
│   │   ├── lib/               # 统一 API 封装（api.ts）与样式工具
│   │   └── pages/             # 各业务模块页面与登录、设置、404 页面
│   ├── components.json        # shadcn/ui 配置
│   ├── vite.config.ts         # Vite 与 /api 开发代理配置
│   └── package.json
├── .env.example               # 环境变量模板
├── .dockerignore              # Docker 构建上下文忽略规则
├── Dockerfile                 # 多阶段单镜像构建文件
├── docker-compose.yml         # Docker Compose 部署示例
├── eslint.config.js           # 根目录 ESLint 配置
├── pnpm-workspace.yaml        # pnpm workspace 配置
└── package.json               # 根脚本与工具链依赖
```

## 本地开发

### 环境要求

- Node.js `>= 22`
- pnpm（仓库通过 `packageManager` 锁定版本，建议执行 `corepack enable` 启用对应版本）

### 初始化与启动

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 复制环境变量模板并填写必要配置：

   ```bash
   cp .env.example .env
   ```

3. 生成管理员密码哈希，并填入 `.env` 中的 `ADMIN_PASSWORD_HASH`（同时将 `SESSION_SECRET` 修改为至少 32 位的随机字符串）：

   ```bash
   pnpm --filter server hash-password <你的密码>
   ```

4. 启动前后端开发服务：

   ```bash
   pnpm dev
   ```

   - 前端开发地址：`http://localhost:5173`（Vite 开发服务器，已配置将 `/api` 请求代理至后端）
   - 后端服务端口：`3000`（默认监听 `0.0.0.0:3000`，可在 `.env` 中通过 `PORT` 调整）

### 常用命令

```bash
pnpm lint          # 运行 ESLint 检查
pnpm typecheck     # 运行前后端 TypeScript 类型检查
pnpm test          # 运行前后端 Vitest 测试
pnpm build         # 构建前端（web/dist）与后端（server/dist）
pnpm format:check  # 检查代码格式（Prettier）
pnpm secrets:scan  # 运行本地密钥扫描（需本机安装 gitleaks；未安装时给出提示）
```

## 配置

项目采用按模块分组的环境变量配置（通过 `zod` 在服务启动时集中校验），所有配置模板均维护在 `.env.example`。

### 准备 `.env`

1. 复制模板文件：

   ```bash
   cp .env.example .env
   ```

2. 生成管理员密码哈希并填入 `ADMIN_PASSWORD_HASH`：

   ```bash
   pnpm --filter server hash-password <你的密码>
   ```

3. 生成至少 32 个随机字符填入 `SESSION_SECRET`（例如执行 `openssl rand -hex 32`）。

### 模块与环境变量说明

#### 1. `app`（应用基础）

| 变量名          | 必填 | 默认值                        | 说明                                                                                   |
| --------------- | ---- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `PORT`          | 否   | `3000`                        | HTTP 监听端口（`1`–`65535`）                                                           |
| `HOST`          | 否   | `0.0.0.0`                     | 服务绑定地址                                                                           |
| `NODE_ENV`      | 否   | `development`                 | 运行环境：`development` / `production` / `test`                                        |
| `DATABASE_URL`  | 否   | `file:./data/homedash.db`     | SQLite 数据库文件路径                                                                  |
| `WEB_DIST_DIR`  | 否   | `../web/dist`                 | 生产环境托管前端静态资源目录                                                           |
| `COOKIE_SECURE` | 否   | 生产环境 `true`，其他 `false` | 会话 Cookie 是否强制 HTTPS；**局域网纯 HTTP 访问生产/Docker 环境时请显式设为 `false`** |
| `TRUST_PROXY`   | 否   | `false`                       | 是否信任反向代理的 `X-Forwarded-For` 请求头作为客户端 IP（仅在可信反代后开启）         |

#### 2. `auth`（认证与会话）

| 变量名                | 必填 | 默认值 | 说明                                                       |
| --------------------- | ---- | ------ | ---------------------------------------------------------- |
| `ADMIN_USERNAME`      | 是   | —      | 管理员登录用户名                                           |
| `ADMIN_PASSWORD_HASH` | 是   | —      | `scrypt` 格式密码哈希                                      |
| `SESSION_SECRET`      | 是   | —      | Cookie 签名密钥（至少 32 个字符）                          |
| `SESSION_TTL_HOURS`   | 否   | `168`  | 会话有效期（小时，默认 7 天）；过期后返回 `401` 并自动清理 |
| `LOGIN_MAX_ATTEMPTS`  | 否   | `5`    | 单 IP 连续登录失败触发锁定的阈值                           |
| `LOGIN_LOCK_MINUTES`  | 否   | `15`   | 触发登录限流后的锁定时长（分钟），锁定期返回 `429`         |

#### 3. 可选采集模块（全部未填时视为“未配置”；同一模块不可部分填写）

| 模块          | 环境变量                                                           | 说明                                        |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `nas`         | `NAS_SSH_HOST`、`NAS_SSH_PORT`、`NAS_SSH_USER`、`NAS_SSH_KEY_PATH` | NAS SSH 采集连接参数与私钥路径              |
| `qbittorrent` | `QBIT_URL`、`QBIT_USERNAME`、`QBIT_PASSWORD`                       | qBittorrent WebUI 地址与凭据                |
| `moviepilot`  | `MOVIEPILOT_URL`、`MOVIEPILOT_API_TOKEN`                           | MoviePilot 服务地址与 API 令牌              |
| `windows`     | `WIN_SSH_HOST`、`WIN_SSH_PORT`、`WIN_SSH_USER`、`WIN_SSH_KEY_PATH` | 家用 Windows 主机 SSH 连接参数与私钥路径    |
| `vps`         | `VPS_LIST_FILE`                                                    | 本地 VPS 信息 JSON 文件路径（名称与到期日） |

### 校验失败报错与安全脱敏

- 若启动时缺少必填项、格式不合法或某个可选模块只填写了部分配置项，服务会在控制台输出**中文错误列表**（逐条列出所属模块、变量名与原因），并以非零退出码退出；**错误信息绝不会打印任何配置值或密钥**。
- 所有含 `PASSWORD`、`HASH`、`SECRET`、`TOKEN`、`KEY` 的配置项集中注册在敏感键清单中，日志输出会通过内置脱敏工具自动替换为 `[REDACTED]`。

### 设置状态接口与状态页

- 已登录状态下可调用受保护接口 `GET /api/settings/status` 查看各模块配置状态（`已配置` / `未配置` / `配置不完整`）以及各键是否已填写（布尔值），响应体**绝不包含任何真实配置值或密钥**；前端 `/settings` 页面会按模块卡片展示状态，支持加载骨架屏、错误提示与重试。

## 后台骨架

前端采用“骨架与业务解耦”的目录分层，可直接作为通用后台模板复用：

- **`web/src/shell/`**：通用后台骨架（`ShellRouter`、`AdminLayout`、`Sidebar`、`Topbar`、`Breadcrumbs`、`ThemeProvider`、`ThemeToggle`、`AuthProvider`、`ProtectedRoute` 及路由树工具），不依赖任何具体业务模块。
- **`web/src/components/common/`**：通用状态与数据展示组件。
- **`web/src/config/navigation.ts`**：单一菜单与路由配置源（`NAV_ROUTES`），同时驱动侧栏菜单（支持嵌套分组）、懒加载路由表、面包屑与页面标题（`页标题 - homedash`）。
- **`web/src/lib/api.ts` 与 `web/src/hooks/useApi.ts`**：统一请求封装（自动 JSON 解析、统一 `ApiError` 中文错误、401 自动清空登录态并跳转 `/login?redirect=...`、429 显示后端限流提示、`expiresAt` 会话过期检测）。
- **主题与响应式布局**：支持亮色 / 暗色 / 跟随系统三档切换（`localStorage` 持久化并在 `web/index.html` 提前写入 `dark` 类避免首屏闪烁）；桌面端支持侧栏折叠成图标栏并持久化，窄屏下切换为抽屉导航。

### 如何新增一个模块页面

新增页面只需两步，**无需修改 `web/src/shell/` 或任何布局代码**：

1. 在 `web/src/pages/` 下创建页面组件（例如 `StoragePage.tsx`），提供默认导出以支持路由懒加载：

   ```tsx
   import { PageHeader, EmptyState } from '@/components/common';

   export default function StoragePage() {
     return (
       <div className="space-y-6">
         <PageHeader title="存储管理" description="查看存储池与磁盘详情" />
         <EmptyState title="即将上线" description="功能建设中" />
       </div>
     );
   }
   ```

2. 在 `web/src/config/navigation.ts` 的 `NAV_ROUTES`（或对应分组的 `children`）中添加一项配置：

   ```ts
   {
     id: 'storage',
     path: '/storage',
     title: '存储管理',
     description: '查看存储池与磁盘详情',
     icon: HardDrive, // 来自 lucide-react
     component: lazy(() => import('@/pages/StoragePage')),
   }
   ```

   添加后侧栏菜单、受保护路由、顶栏面包屑和浏览器标题会自动同步生成。

### 通用组件列表

| 组件           | 路径                                         | 用途与主要属性                                                                                                                  |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DataCard`     | `web/src/components/common/DataCard.tsx`     | 指标/概览卡片：`title`、`value`、`description`、`icon`、`status`、`statusLabel`                                                 |
| `StatusBadge`  | `web/src/components/common/StatusBadge.tsx`  | 状态徽章：`status`（`success`/`configured`/`warning`/`incomplete`/`error`/`unknown`/`unconfigured`/`info`）、`label`、`showDot` |
| `EmptyState`   | `web/src/components/common/EmptyState.tsx`   | 空状态/占位提示：`title`、`description`、`icon`、`action`                                                                       |
| `LoadingState` | `web/src/components/common/LoadingState.tsx` | 加载态/骨架屏：`variant`（`spinner`/`skeleton`）、`rows`、`message`                                                             |
| `ErrorState`   | `web/src/components/common/ErrorState.tsx`   | 错误态与重试：`title`、`message`、`onRetry`、`retryLabel`                                                                       |
| `PageHeader`   | `web/src/components/common/PageHeader.tsx`   | 页面标题栏：`title`、`description`、`actions`                                                                                   |

### 密钥扫描

- **本地扫描**：运行 `pnpm secrets:scan`；若本机已安装 `gitleaks`，将基于 `.gitleaks.toml` 执行全仓库检测，未安装时提示并正常退出。
- **CI 扫描**：`.github/workflows/ci.yml` 包含独立的 `gitleaks` 任务，对每次 PR 与主干推送拉取完整历史（`fetch-depth: 0`）并自动扫描。`.gitleaks.toml` 继承默认规则，仅针对 `server/test/*.test.ts` 中的明显测试占位串放行。

## 生产运行

在宿主机直接构建并运行（需确保 `.env` 中 `NODE_ENV=production`）：

```bash
pnpm install --frozen-lockfile
pnpm build
node server/dist/index.js
```

当 `NODE_ENV=production` 时，后端会自动托管前端构建产物（默认读取 `../web/dist`，可通过 `WEB_DIST_DIR` 自定义），并自动创建数据目录与执行 Drizzle 迁移。若仅通过局域网 HTTP 访问（未启用 HTTPS），请在 `.env` 中显式设置 `COOKIE_SECURE=false`。

## Docker 部署

项目提供多阶段构建的 `Dockerfile` 与单服务 `docker-compose.yml` 示例，镜像内以非 `root` 用户（`node`）运行，数据库文件持久化在 `/app/data/homedash.db`，并内置 `/api/health` 健康检查。

1. 准备配置文件：

   ```bash
   cp .env.example .env
   ```

   按需填写 `.env` 中的 `ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`（通过 `pnpm --filter server hash-password <你的密码>` 或任意等价方式提前生成）与 `SESSION_SECRET`。若在局域网内通过纯 HTTP 访问，请将 `.env` 中的 `COOKIE_SECURE=false` 取消注释。

2. 创建本地持久化数据目录（避免宿主机以 `root` 自动创建目录导致非 `root` 容器用户无权限写入）：

   ```bash
   mkdir -p data
   ```

3. 构建并后台启动容器：

   ```bash
   docker compose up -d --build
   ```

   启动后通过宿主机 `3000` 端口访问控制台；常用运维命令：

   ```bash
   docker compose logs -f homedash  # 查看日志
   docker compose down              # 停止并移除容器（./data 数据保留）
   ```

## 开发流程

1. 需求拆成 Linear issue，写清目标和验收标准
2. 编程 agent（Antigravity CLI `agy`）在独立的 git worktree 里完成单个 issue
3. 跑测试，前端附截图
4. 提 PR，人工审核后合并

## 安全约定

所有地址、账号、密码和密钥只放在本地 `.env`，绝不提交到仓库。

## 许可证

MIT
