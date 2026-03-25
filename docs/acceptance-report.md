# 验收报告

## 1. 验收范围

本次验收聚焦当前主线交付：

- Telegram 远程控制 Codex CLI 的个人使用路径
- 逻辑会话创建、历史对话接入、发送 prompt、查看输出、读取文件、切换活动会话、终止会话
- `/help`、`/projects`、`/list`、`/activate`、`/send`、`/screen`、`/read` 等核心命令的真实代码口径
- `/send` 自动等待当前轮回复的交互模式，包括即时 `/screen` 提示和最终结果分离
- 会话、任务、来源绑定持久化与重启恢复

不在本次主验收范围内：

- VS Code GUI 自动化
- macOS 完整生产验收
- 高风险真实系统动作作为主验收目标

## 2. 验收依据

- 需求文档：`docs/requirements.md`
- 系统设计：`docs/system-design.md`
- 开发计划：`docs/development-plan.md`
- 当前状态摘要：`.agent/current-state.md`
- 本次归档报告：`docs/acceptance-reports/2026-03-25-help-command-sync.md`

## 3. 测试环境

| 项目 | 说明 |
| --- | --- |
| 宿主系统 | Windows 开发环境 |
| 运行时 | Node.js 项目运行时 |
| 核心入口 | `npm run tg:bot`、`npm test` |
| Codex 控制路径 | `codex exec --json`、`codex exec resume` |
| 当前测试类型 | 自动化单元/集成测试 + 本地运行链路验证 |

## 4. 自动化验证结果

- 执行命令：`npm test`
- 最新结果：`86/86` 通过，`0` 失败
- 覆盖重点：
  - 命令解析与参数校验
  - `/help` 运行时帮助文本
  - `/projects`、`/create`、`/list`、`/activate`
  - `/send` 自动等待、即时 `/screen` 提示、超时结果判定
  - `/screen`、`/read`、`/enablePermission`、`/disablePermission`、`/kill`
  - 历史会话续聊、activate、resume
  - 会话/任务/绑定持久化与启动恢复
  - Telegram 入口、通知分片、配置加载
  - 系统适配器基础路径

## 5. 用例与结果

| 用例 | 对应需求 | 结果 | 说明 |
| --- | --- | --- | --- |
| 创建逻辑会话并绑定项目目录 | `FR-001` | 通过 | `/create` 返回会话编号、项目路径和可用状态 |
| 发现允许根目录下的项目目录 | `FR-008` | 通过 | `/projects` 支持项目列举和越界拒绝 |
| Telegram 接收、鉴权与消息路由 | `FR-002` | 通过 | 合法来源可用，非法来源被拒绝 |
| `/help` 输出当前命令说明与配置摘要 | `FR-007` | 通过 | 帮助内容会根据运行配置实时生成 |
| `/list` 聚合托管会话和本机历史会话 | `FR-007` | 通过 | 支持编号模式、历史展开和活动会话标记 |
| `/activate` 切换当前聊天绑定会话 | `FR-007` | 通过 | 既可切换托管会话，也可直接激活历史对话 |
| `/send` 自动等待当前轮回复 | `FR-003` | 通过 | 覆盖 `settled`、`timeout`、`ui_only_activity` |
| `/send` 开始后立即返回推荐 `/screen` 指令 | `FR-003` | 通过 | 即时通知与最终完成消息已拆分 |
| 直接向历史 Codex 会话续聊 | `FR-006` | 通过 | 支持 `codexConversationId`、`/list` 编号和 `/activate` 路径 |
| `/screen` 查看完整与增量输出 | `FR-004` | 通过 | 支持 cursor 增量查看 |
| `/read` 读取项目内文件 | `FR-004` | 通过 | 路径边界校验有效 |
| Session permission toggling and kill control | `FR-005` | Pass | auto/manual state switching, the default `auto -> dangerous` path, and termination behavior are all verifiable |
| 会话、任务、来源绑定持久化 | `FR-006` | 通过 | 文件持久化测试通过 |
| 启动恢复与残留会话清理 | `FR-006` | 通过 | 未完成任务被标记为中断 |
| `/sys` 返回宿主机摘要 | `FR-007` | 通过 | 可查看 CPU、内存、活动会话数 |
| 配置加载与运行时参数切换 | `FR-008` | 通过 | Telegram 参数、目录白名单、等待时间均可配置 |

## 6. 问题清单

- 本轮自动化测试未发现阻断当前主线交付的失败项
- 仍需继续观察复杂真实开发任务下的完成态识别稳定性

## 7. 风险评估

1. `/enablePermission` now defaults remote runs to `auto -> dangerous`; this is necessary for remote autonomy, but it must remain limited to trusted hosts and whitelisted projects.
2. Assistant completion detection still depends on output semantics and may need more tuning in complex real tasks.
3. The default `/send` wait is already one hour, but extremely long jobs may still require manual follow-up with `/screen`.
4. macOS has not yet been validated to the same depth as Windows.
5. Real shutdown actions are not a delivery criterion for the main path, and service/logging/alert hardening still needs work.

## 8. 结论与后续建议

当前版本通过了“Windows + Telegram + Codex CLI 远程控制主链路”的阶段验收，满足个人远程开发使用的 MVP 要求：

- 可以远程创建或接入 Codex 会话
- 可以通过 `/send` 直接下发开发任务并等待当前轮结果
- 可以通过 `/help`、`/screen`、`/read`、`/list`、`/activate`、`/sys` 进行补充控制与查看
- 可以在同一主机重启后继续使用已持久化的逻辑会话

后续建议：

1. 继续优化复杂输出场景下的完成态识别
2. 补齐 Windows 常驻服务部署方案和异常告警策略
3. 在明确需要时，再推进 macOS 真实验证与回写
4. 保持系统动作默认 `dry-run`，优先保证远程控制主链路稳定性




