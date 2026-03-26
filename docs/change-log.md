# 变更日志

## 当前状态

- 当前主线已经统一为：`Telegram` 远程控制 `Codex CLI` 会话，`Windows` 为主要交付平台
- `/help` 已上线，可根据当前运行配置展示真实命令、允许根目录、等待时长、执行档位和系统模式
- `/send` 负责发送 prompt 并自动等待当前轮回复，默认内部等待窗口为 `3600000ms`，即 1 小时
- `/send` 在开始执行后会立即单独返回一条推荐的 `/screen` 指令，最终完成消息只保留结果本身，减少 Telegram 长消息噪音
- `/list` 已统一展示托管会话和本机可恢复的 Codex 历史会话，并支持编号选择；`/activate` 可切换当前聊天绑定的活动会话
- `/ls`?`/find` ??? `/read` ??????????????????????????
- Remote permission strategy is configurable: `safe`, `full-auto`, and `dangerous`; the current default mapping is `manual -> safe` and `auto -> dangerous`, so `/enablePermission` now truly opens the remote-friendly path
- 会话、任务、来源绑定支持本地持久化；服务重启时会执行恢复与未完成任务中断标记
- 高风险系统动作支持适配层与真实执行模式，但当前交付重点仍然是远程控制主链路，而不是关机联动

## 最近完成

### 2026-03-26 lightweight browse commands

- Added `/ls` for session-bound directory browsing with remembered current folder state.
- Added `/find` for name-based project search and made the latest browse result reusable by `/ls -p <number>` and `/read -f <number>`.
- Updated `/read` so direct paths are resolved against the current browse folder when present, while numbered selections download the matched file as an attachment.
- Added automation coverage for directory browsing, search-result handoff, and invalid numbered `/read` directory selection handling.
- Verification: `npm test` => `92/92`.

### 2026-03-26 /read attachment delivery

- `/read` no longer inlines file bodies into Telegram messages; it now returns the resolved project file as a document attachment.
- `src/telegram-client.js` and `src/telegram-notifier.js` now support Telegram `sendDocument`, including the PowerShell fallback path used on blocked Windows hosts.
- `src/codex-adapter.js` now returns file metadata for `/read`, and `src/automation-agent.js` forwards attachment metadata into the completion notification.
- Tests updated across automation, adapter, Telegram client, and Telegram runtime coverage.
- Verification: `npm test` => `89/89`.

### 2026-03-25 Documentation Consistency Cleanup

- Re-reviewed active docs against the current Telegram + Codex CLI implementation baseline.
- Confirmed the current permission default remains `manual -> safe` and `auto -> dangerous`.
- Bumped `docs/requirements.md` to `v1.4.3` and filled the missing `/disablePermission` scope coverage.
- README, design, plan, acceptance, and state/traceability docs were checked again; only out-of-sync files were updated in this pass.


### 2026-03-25 Remote Permission Default Fix

- Root cause confirmed: `/enablePermission` only switched a session to `auto`, but the old default `auto -> full-auto` could still be blocked by sandbox or network restrictions.
- The default runtime policy is now aligned with real remote usage: `manual -> safe`, `auto -> dangerous`.
- Automated verification for this fix: `npm test` => `86/86`.
- The environment override remains available: `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE` can still be set back to `full-auto` on more conservative hosts.
- Git release: `0d46ad8` was pushed to `origin/main`.


### 2026-03-25 `/help` 指令与文档同步

- 在 `src/automation-agent.js` 中接入 `/help` 命令分发、运行时帮助文本生成和返回格式化
- 帮助文本已对齐当前实际运行配置：允许根目录、默认等待时间、权限模式、执行档位、sandbox 与系统模式
- 补充测试：`tests/message-parser.test.js` 与 `tests/automation-agent.test.js`
- 同步回写 `README.md`、`docs/requirements.md`、`docs/system-design.md`、`docs/development-plan.md`、`docs/acceptance-report.md`、`.agent/current-state.md`、`.agent/traceability.md`
- Verification at that time: `npm test` => `84/84`
- Git 发布：`0c083ea` 已成功推送到 `origin/main`

### 2026-03-24 近期基线能力

- `/activate -n <sessionId|codexConversationId|listNumber> [-w <workspace>]`：切换当前聊天绑定的活动会话，并可直接接管历史对话
- `/list -a`、`/list -c <count>`：展开本机 Codex 历史会话；可见条目支持编号操作
- `/projects`：列出允许根目录下的首层项目目录，减少 `/create` 的手输路径成本
- `/send -n <codexConversationId>`：直接向本机历史 Codex 对话续聊，必要时自动补建托管会话
- Telegram 运行时已接入文件持久化和启动恢复；WeCom 入口仍保留为可选兼容模块

## 关键文件入口

- 需求文档：`docs/requirements.md`
- 系统设计：`docs/system-design.md`
- 开发计划：`docs/development-plan.md`
- 验收报告：`docs/acceptance-report.md`
- 当前状态摘要：`.agent/current-state.md`
- 当日日志：`docs/dev-logs/2026/2026-03-25.md`
- 核心编排：`src/automation-agent.js`
- Codex 驱动：`src/codex-adapter.js`
- Telegram 入口：`src/telegram-entry.js`

## 日志索引

- `docs/dev-logs/2026/2026-03-26.md`
- `docs/dev-logs/2026/2026-03-25.md`
- `docs/dev-logs/2026/2026-03-24.md`
- 历史阶段验收：`docs/acceptance-reports/`


