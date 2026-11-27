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

待定，见 Linear 任务「技术选型与项目脚手架」。

## 开发流程

1. 需求拆成 Linear issue，写清目标和验收标准
2. 编程 agent（Antigravity CLI `agy`）在独立的 git worktree 里完成单个 issue
3. 跑测试，前端附截图
4. 提 PR，人工审核后合并

## 安全约定

所有地址、账号、密码和密钥只放在本地 `.env`，绝不提交到仓库。

## 许可证

MIT
