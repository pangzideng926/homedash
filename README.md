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
├── .github/workflows/ci.yml   # GitHub Actions CI 工作流
├── server/                    # Node.js + Hono 后端服务
│   ├── drizzle/               # Drizzle SQLite 数据库迁移文件
│   ├── src/                   # 服务端源码（配置、鉴权、数据库、路由）
│   ├── test/                  # 后端单元测试
│   ├── drizzle.config.ts      # Drizzle Kit 配置
│   └── package.json
├── web/                       # React + Vite 前端应用
│   ├── src/                   # 前端源码（页面、布局、鉴权上下文、UI 组件）
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
```

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
