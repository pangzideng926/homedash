# homedash

家庭服务器控制台：把家里 NAS、刷流做种、家用设备（Windows / macOS / Linux）、VPS 和各类账号告警集中到一个网页里查看。同时也是一套可复用的通用后台模板骨架。

## 规划与已实现功能

- NAS 状态监控与受限容器运维（Linux SSH 只读：CPU/内存、传感器温度、`/proc/mdstat` RAID、`/volume*` 卷、Docker `ps` + `stats` 与受限启停/日志查看/审计）
- 多实例下载器监控（qBittorrent WebUI API v2 + Transmission RPC 只读白名单：多实例汇总、用途标签、速度/分享率、状态分组、Tracker/分类或标签统计与异常种子排查）
- MoviePilot 影视订阅与入库监控（以官方仓库 `jxxghp/MoviePilot` 当前默认分支 v3 为准，只读接口白名单）
- 加密集成凭据管理（在 `/settings` 页面配置，AES-256-GCM 加密与 `.env` 优先级覆盖）
- 家用设备状态（多设备 SSH 只读采集，支持 Windows / macOS / Linux，界面增删改与连通性测试）
- VPS 到期提醒
- 账号登录与安全告警汇总（告警汇总待接入）
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
├── devices.example.json       # 家用设备清单 JSON 示例文件（全部为占位数据）
├── vps.example.json           # VPS 清单 JSON 示例文件（全部为占位数据）
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

| 变量名                  | 必填 | 默认值                        | 说明                                                                                        |
| ----------------------- | ---- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| `PORT`                  | 否   | `3000`                        | HTTP 监听端口（`1`–`65535`）                                                                |
| `HOST`                  | 否   | `0.0.0.0`                     | 服务绑定地址                                                                                |
| `NODE_ENV`              | 否   | `development`                 | 运行环境：`development` / `production` / `test`                                             |
| `DATABASE_URL`          | 否   | `file:./data/homedash.db`     | SQLite 数据库文件路径                                                                       |
| `WEB_DIST_DIR`          | 否   | `../web/dist`                 | 生产环境托管前端静态资源目录                                                                |
| `COOKIE_SECURE`         | 否   | 生产环境 `true`，其他 `false` | 会话 Cookie 是否强制 HTTPS；**局域网纯 HTTP 访问生产/Docker 环境时请显式设为 `false`**      |
| `TRUST_PROXY`           | 否   | `false`                       | 是否信任反向代理的 `X-Forwarded-For` 请求头作为客户端 IP（仅在可信反代后开启）              |
| `TZ_DISPLAY`            | 否   | `Asia/Shanghai`               | 展示日期与 VPS 到期天数计算使用的 IANA 时区名称                                             |
| `INTEGRATIONS_FILE`     | 否   | —                             | 集成凭据本地 JSON 存储路径（如 `./secrets/integrations.json`），启用后支持在设置页保存配置  |
| `CONFIG_ENCRYPTION_KEY` | 否   | —                             | 集成凭据加密密钥（至少 32 个字符；未设置时自动使用 `SESSION_SECRET` 通过 HKDF-SHA256 派生） |

#### 2. `auth`（认证与会话）

| 变量名                | 必填 | 默认值 | 说明                                                       |
| --------------------- | ---- | ------ | ---------------------------------------------------------- |
| `ADMIN_USERNAME`      | 是   | —      | 管理员登录用户名                                           |
| `ADMIN_PASSWORD_HASH` | 是   | —      | `scrypt` 格式密码哈希                                      |
| `SESSION_SECRET`      | 是   | —      | Cookie 签名密钥（至少 32 个字符）                          |
| `SESSION_TTL_HOURS`   | 否   | `168`  | 会话有效期（小时，默认 7 天）；过期后返回 `401` 并自动清理 |
| `LOGIN_MAX_ATTEMPTS`  | 否   | `5`    | 单 IP 连续登录失败触发锁定的阈值                           |
| `LOGIN_LOCK_MINUTES`  | 否   | `15`   | 触发登录限流后的锁定时长（分钟），锁定期返回 `429`         |

#### 3. 可选采集模块

`nas`、`qbittorrent`、`moviepilot` 三个模块支持在 `.env` 中配置或通过 `/settings` 页面的“集成配置”区加密保存（`.env` 优先级高于文件，`.env` 可全部留空或仅配置部分字段如缓存/模拟开关）。

| 模块          | 环境变量                                                                                                                                                                                                      | 说明                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nas`         | `NAS_SSH_HOST`、`NAS_SSH_PORT`、`NAS_SSH_USER`、`NAS_SSH_KEY_PATH`、`NAS_MOCK`、`NAS_CACHE_SECONDS`、`DOCKER_ACTIONS_ENABLED`、`DOCKER_PROTECTED_CONTAINERS`、`DOCKER_AUDIT_FILE`、`DOCKER_ACTION_TIMEOUT_MS` | NAS 只读 SSH 采集参数、缓存时间（默认 `30` 秒）与受限 Docker 操作开关（默认 `false`）、受保护容器（默认 `homedash`）、审计日志路径（默认 `./data/docker-audit.log`）及操作命令超时（毫秒，默认 `60000`，范围 `5000..300000`） |
| `downloaders` | `DOWNLOADERS_MOCK`、`DOWNLOADER_CACHE_SECONDS`、`DOWNLOADER_TIMEOUT_MS`、`DOWNLOADER_ACTIVE_TASKS_LIMIT`                                                                                                      | 多实例下载器（qBittorrent / Transmission）缓存时间（默认 `10` 秒）、超时（默认 `8000` 毫秒）与每实例活跃任务默认返回条数上限（默认 `10`，范围 `1..100`）；`DOWNLOADERS_MOCK=true` 返回 3 个模拟实例                           |
| `qbittorrent` | `QBIT_URL`、`QBIT_USERNAME`、`QBIT_PASSWORD`、`QBIT_MOCK`、`QBIT_CACHE_SECONDS`、`QBIT_TIMEOUT_MS`                                                                                                            | 旧版单实例 qBittorrent 配置；未配置 `downloaders` 数组时自动迁移为 `qbittorrent-default`（`.env` 来源为只读）                                                                                                                 |
| `moviepilot`  | `MOVIEPILOT_URL`、`MOVIEPILOT_API_TOKEN`、`MOVIEPILOT_MOCK`、`MOVIEPILOT_CACHE_SECONDS`、`MOVIEPILOT_TIMEOUT_MS`、`MOVIEPILOT_ACTIVE_LIMIT`                                                                   | MoviePilot v3 地址与 API 令牌、缓存时间（默认 `60` 秒）、超时（默认 `8000` 毫秒）与正在下载/整理队列默认返回条数上限（默认 `10`，范围 `1..100`）                                                                              |
| `media`       | `MEDIA_CACHE_SECONDS`、`MEDIA_IMAGE_HOSTS`、`MEDIA_IMAGE_CACHE_DIR`、`MEDIA_IMAGE_CACHE_MAX`                                                                                                                  | 影视模块聚合接口缓存时间（默认 `30` 秒）、海报代理额外白名单主机（默认内置 `image.tmdb.org` 与 `*.doubanio.com`）、磁盘缓存目录（默认 `./data/image-cache`）与内存 LRU 上限（默认 `200` 张）                                  |
| `devices`     | `DEVICES_FILE`、`DEVICES_READONLY`、`DEVICES_MOCK`、`DEVICE_SSH_TIMEOUT_MS`、`DEVICE_CACHE_SECONDS`                                                                                                           | 多设备家用主机（Windows / macOS / Linux）清单与只读 SSH 采集参数；`DEVICES_MOCK=true` 返回模拟 Windows 与 macOS 设备                                                                                                          |
| `windows`     | `WIN_SSH_HOST`、`WIN_SSH_PORT`、`WIN_SSH_USER`、`WIN_SSH_KEY_PATH`、`WIN_SSH_TIMEOUT_MS`、`WIN_CACHE_SECONDS`、`WIN_MOCK`                                                                                     | 旧版兼容：未配置 `DEVICES_FILE` 时自动迁移为只读“Windows 设备”；`WIN_MOCK=true` 兼容等效于 `DEVICES_MOCK=true`                                                                                                                |
| `vps`         | `VPS_LIST_FILE`、`VPS_READONLY`                                                                                                                                                                               | 本地 VPS 信息 JSON 文件路径与只读模式开关（`VPS_READONLY=true` 时禁止页面编辑与 `PUT /api/vps` 写入）                                                                                                                         |

#### 4. 集成凭据存储、NAS Docker 与多实例下载器说明

- **加密集成凭据存储（`INTEGRATIONS_FILE`）**：
  - 敏感字段（`downloaders[].password`、`qbittorrent.password`、`moviepilot.apiToken`）使用 AES-256-GCM 加密（每个字段独立随机 12 字节 IV，存储 `{v:1, iv, tag, data}` Base64 结构），加密密钥来自 `CONFIG_ENCRYPTION_KEY`，未设置时使用 `SESSION_SECRET` 通过 HKDF-SHA256（固定 info `"homedash-integrations-v1"`）派生。非敏感字段明文存储，写入前生成 `.bak` 备份并执行原子替换。
  - `.env` 中已设置的字段优先级最高，界面显示为只读并标注“由 .env 管理”，通过 `PUT /api/integrations/:module` 或 `PUT /api/downloaders` 修改对应项会返回 `409`。`GET /api/integrations` 与 `GET /api/downloaders` 永远只返回敏感字段是否已设置（`set` / `passwordSet`），绝不返回明文或密文。
- **NAS 只读 SSH 采集与 Docker 容器受限操作**：
  - 状态采集复用 `ssh2` 执行固定只读脚本，采集主机信息、`/etc/os-release`、`/proc/uptime`、`/proc/loadavg`、`/proc/stat`（两次采样）、`/proc/meminfo`、`/sys/class/thermal` 与 `/sys/class/hwmon` 分组温度、`/proc/mdstat` RAID 状态、`df -kPT`（重点展示 `/volume*`）、`docker ps -a` 以及 `docker stats --no-stream`（按容器名合并 CPU% 与内存占用，失败自动忽略）。
  - NAS 上用于 SSH 连接的账号需要加入 `docker` 用户组才能看到并操作容器，可在 NAS 上执行以下命令后重新登录使其生效：

    ```bash
    sudo usermod -aG docker <用户名>
    ```

  - 容器操作默认关闭（`DOCKER_ACTIONS_ENABLED=false`），开启后仅允许 `POST /api/nas/docker/:name/:action` 执行 `start` / `stop` / `restart`（严禁 `rm`、`exec`、`pull`、`run`、`kill` 或任意命令）。容器名须同时通过正则白名单 `/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/` 与实时 `docker ps -a --format '{{.Names}}'` 校验，且使用固定命令模板拼接（`docker start -- '<name>'`、`docker stop -t <sec> -- '<name>'`、`docker restart -t <sec> -- '<name>'`，默认等待 `-t 30` 秒）。`DOCKER_ACTION_TIMEOUT_MS`（范围 `5000..300000`，默认 `60000`）仅用于操作命令本身；若配置值小于 `35000`，`stop`/`restart` 等待秒数自动收敛为 `max(1, floor(超时/1000) - 5)`；操作前 `docker ps -a` 校验与日志读取仍沿用 `DEVICE_SSH_TIMEOUT_MS`。操作命令超时返回 `504` 提示并清除 NAS 状态缓存。
  - `DOCKER_PROTECTED_CONTAINERS`（默认 `homedash`）中的受保护容器禁止 `stop` / `restart`（返回 `403`），所有操作尝试（含被拒绝请求）都会以 JSON Lines 追加写入 `DOCKER_AUDIT_FILE`（默认 `./data/docker-audit.log`），并可通过 `GET /api/nas/docker/audit` 只读查看。
  - `GET /api/nas/docker/:name/logs?tail=200`（`tail` 限制 `1..1000`）用于只读查看容器日志，需登录但无需开启 `DOCKER_ACTIONS_ENABLED`。
  - **多实例下载器（qBittorrent + Transmission 只读）**：
  - 在 `/settings` 页面的“集成配置 -> 下载器”区可管理多个 qBittorrent / Transmission 实例及用途标签（`download` 下载 / `brush` 刷流 / `seed` 保种）；若尚未保存 `downloaders` 数组但存在旧单实例 `qbittorrent` 配置（`.env` `QBIT_*` 或文件 `qbittorrent` 段），系统会自动迁移生成 `qbittorrent-default` 实例；旧接口 `/api/qbittorrent/summary` 保留为兼容别名（优先读取旧配置，否则返回第一个启用 qB 实例摘要）。
  - 支持每实例活跃任务汇总（`activeTasks` / `activeTotal`，包含下载中、速度 > 0 的做种任务与出错任务），且 `GET /api/downloaders/:id/summary?activeLimit=` 支持在 `1..100` 范围内按需调整返回条数。
  - **qBittorrent**（WebUI API v2 只读）：按实例隔离 `SID` 会话（遇 `403` 自动重登一次），仅调用只读白名单接口（`/api/v2/app/version`、`/api/v2/transfer/info`、`/api/v2/sync/maindata`、`/api/v2/torrents/info`、`/api/v2/torrents/categories`）。
  - **Transmission**（RPC 只读）：请求 `POST {url}/transmission/rpc`（支持 Basic 认证与 `409` `X-Transmission-Session-Id` 按实例缓存重试一次），严格限制方法白名单（`session-get`、`session-stats`、`torrent-get`）与只读字段白名单（含 `eta`、`rateDownload`、`rateUpload`、`percentDone` 等），严禁 `torrent-start/stop/remove/set/add` 等任何写操作。
- **MoviePilot（以官方仓库 `jxxghp/MoviePilot` 当前默认分支 v3 为准）**：
  - 接口全部来源于官方仓库 `jxxghp/MoviePilot` v3 分支，使用 `X-API-KEY` 请求头认证，严格限制只读 GET 白名单：`GET /api/v1/subscribe/list`、`GET /api/v1/subscribe/calendar`（起止日期窗口限制 ≤ 93 天）、`GET /api/v1/history/transfer`、`GET /api/v1/download/`、`GET /api/v1/transfer/queue/page`（仅提取媒体标题、季、状态计数与文件 basename，绝不返回完整路径；旧版本返回 404 时自动降级不影响其它数据）、`GET /api/v1/dashboard/statistic`、`GET /api/v1/site/`（服务端显式剥离 `cookie`/`ua`/`apikey`/`token` 等敏感字段，仅保留 `id`/`name`/`domain`/`is_active`/`pri`）、`GET /api/v1/site/statistic`、`GET /api/v1/dashboard/downloader2`。绝不调用 `/api/v1/system/*`、`/api/v1/site/test/*`、`/download/start|stop`、`/transfer/now` 等有副作用接口。
- **影视模块实例归属与海报安全代理**：
  - **用 `tag` 区分下载器归属**：影视模块（`/media`）只聚合带 `download` 标签的 qBittorrent 实例（用于正在下载与 hash 合并）、带 `seed` 标签的保种实例（用于保种数/上传速率/总上传量统计）与 MoviePilot v3；带 `brush` 标签的刷流实例不进入影视模块，而是在 `/brush`（刷流）页独立展示，“下载器”（`/seeding`）页展示全部实例。在 `/settings` 修改实例用途标签即可立即调整归属，无需额外配置。
  - **海报安全代理（`/api/media/image/:token`）**：所有海报 URL 经 `SESSION_SECRET` 派生子密钥做 HMAC-SHA256 签名（截断 16 字节），校验签名后仅允许通过 `https` 抓取白名单主机（默认 `image.tmdb.org`、`*.doubanio.com`，可通过 `MEDIA_IMAGE_HOSTS` 追加），手动处理重定向（最多 2 次且逐次校验白名单）、限制 `image/*` 响应与 5MB 上限，并自动将 TMDB `/t/p/original/` 改写为 `/t/p/w342/`；MoviePilot 相对路径或自身图片接口（如 `/api/v1/system/img`）一律丢弃。

#### 5. 家用设备（`devices`）、macOS SSH 与 VPS 清单说明

- **家用设备清单（`DEVICES_FILE`）**：可参考仓库根目录的 [`devices.example.json`](./devices.example.json) 复制为本地文件（如 `./secrets/devices.json`），格式为 `{"devices":[{"id","name","host","port","user","keyPath","os","enabled","note"}]}`，支持 `auto` / `windows` / `macos` / `linux`。在网页中编辑保存（`PUT /api/devices`）时，服务端先生成同目录 `.bak` 备份并通过临时文件原子替换；`DEVICES_READONLY=true` 时禁止编辑。**接口与界面绝不读取、上传或展示私钥内容**，仅保存服务器上私钥文件的路径 `keyPath`。
- **旧版兼容与路由说明**：未配置 `DEVICES_FILE` 但配置了 `WIN_SSH_*` 时，系统会自动生成一台只读虚拟设备（`legacy-windows`），界面会提示配置 `DEVICES_FILE` 后可编辑；旧接口 `/api/windows/status` 保留为兼容别名（返回第一台启用 Windows 设备状态），旧前端路由 `/pc` 自动重定向到 `/devices`。
- **各系统只读采集脚本**：后端通过纯 JS `ssh2` 连接目标主机，当 `os=auto` 时先执行只读 `uname -s` 判定 `Darwin`（`macos`）或 `Linux`（`linux`），若非 Unix 再执行只读 PowerShell 版本探测判定 `windows`（识别结果按设备缓存 10 分钟）。随后按系统执行固定只读脚本（Windows `Get-CimInstance`、macOS `sysctl`/`sw_vers`/`vm_stat`/`top`/`df -k`、Linux `/proc/*` 与 `df -kP`），**绝不包含任何重启、关机、写文件、安装或修改远端状态的命令**。
- **macOS SSH 配置建议**：
  1. 在目标 Mac 上打开：**系统设置 → 通用 → 共享 → 远程登录**（开启 SSH 服务，建议仅允许指定用户）。
  2. 为降低风险，建议在目标主机的 `~/.ssh/authorized_keys` 中为专用的只读采集公钥增加来源 IP 与命令限制，例如：`from="192.0.2.10",restrict ssh-ed25519 AAAA... demo@homedash`（按需结合仅允许连接与只读命令场景配置）。
  3. 若 Mac 局域网 IP 可能变化，建议在路由器中为该 Mac 配置静态 DHCP 地址绑定，或在设备 `host` 中填写 mDNS `.local` 主机名（如 `demo-mac.local`）。
- **VPS 清单文件（`VPS_LIST_FILE`）**：可参考仓库根目录的 [`vps.example.json`](./vps.example.json) 复制为本地文件（如 `./secrets/vps.json`）。`name` 与 `expiresAt`（`YYYY-MM-DD`）为必填字段，`id`、`provider`、`price`、`currency`、`renewUrl`、`note` 均可选/可空。通过网页编辑保存时，服务端会在写入前生成同目录 `.bak` 备份并执行临时文件原子替换。

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
