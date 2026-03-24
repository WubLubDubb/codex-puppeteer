# 变更日志

## 当前状态

- 当前主线已经统一为：`Telegram` 远程控制 `Codex CLI` 会话，`Windows` 为主要交付平台。
- `/send` 负责发送 prompt 并自动等待当前轮回复，默认内部等待窗口为 `3600000ms`，即 1 小时。
- `/send` 在开始执行后会立即单独返回一条推荐的 `/screen` 指令，最终完成消息只保留结果本身，减少 Telegram 长消息噪音。
- `/list` 已统一展示托管会话和本机可恢复的 Codex 历史会话，并支持编号选择；`/activate` 可切换当前聊天绑定的活动会话。
- 会话、任务、来源绑定支持本地持久化；服务重启时会执行恢复与未完成任务中断标记。
- 高风险系统动作支持适配层与真实执行模式，但当前交付重点仍然是远程控制主链路，而不是关机联动。

## 最近完成

### 2026-03-24 文档与交互同步

- 将核心文档统一回写为当前代码口径，修复旧版需求、设计、计划、验收文档中的乱码与过期描述。
- 将 `/send` 的推荐 `/screen` 指令调整为即时单独通知，并把默认等待窗口提升到 `3600000ms`。
- 同步更新 `README.md`、`.env.example`、`.agent/current-state.md` 与当日日志。
- 最新自动化验证：`npm test` => `81/81`。

### 2026-03-24 近期已完成能力

- `/activate -n <sessionId|listNumber>`：切换当前聊天绑定的活动会话。
- `/list -a`、`/list -c <count>`：展开本机 Codex 历史会话；可见条目支持编号操作。
- `/projects`：列出允许根目录下的首层项目目录，减少 `/create` 的手输路径成本。
- `/send -n <codexConversationId>`：直接向本机历史 Codex 对话续聊，必要时自动补建托管会话。
- Telegram 运行时已接入文件持久化和启动恢复；WeCom 入口仍保留为可选兼容模块。

## 关键文件入口

- 需求文档：`docs/requirements.md`
- 系统设计：`docs/system-design.md`
- 开发计划：`docs/development-plan.md`
- 验收报告：`docs/acceptance-report.md`
- 当前状态摘要：`.agent/current-state.md`
- 当日日志：`docs/dev-logs/2026/2026-03-24.md`
- 核心编排：`src/automation-agent.js`
- Codex 驱动：`src/codex-adapter.js`
- Telegram 入口：`src/telegram-entry.js`

## 日志索引

- [2026-03-24 开发日志](/f:/Project/codex-puppeteer/docs/dev-logs/2026/2026-03-24.md)
- 历史阶段验收：`docs/acceptance-reports/`
