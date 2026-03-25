# 追踪矩阵

## 当前追踪范围

当前追踪基于 `2026-03-25` 的主线基线：项目已经从“微信控制 VS Code Codex”收敛为“Telegram 远程控制本机 Codex CLI”。追踪重点是远程控制主链路、历史会话通过 `/activate` 或 `/send` 接管、持久化恢复，以及 `/help` 带来的命令可发现性。

## 需求到设计、实现与验收映射

| 需求 | 设计模块 | 主要实现 | 主要验证 | 当前状态 |
| --- | --- | --- | --- | --- |
| `FR-001` 会话创建与项目根目录绑定 | 项目上下文解析、会话仓储、Codex 适配层 | `src/automation-agent.js`、`src/context-resolver.js`、`src/session-repository.js`、`src/codex-adapter.js` | `tests/automation-agent.test.js` | 已实现 |
| `FR-002` 远程消息接入、鉴权与路由 | Telegram/WeCom 接入层、命令解析层、策略层 | `src/telegram-*.js`、`src/wecom-*.js`、`src/message-parser.js`、`src/policy-engine.js` | `tests/message-parser.test.js`、`tests/telegram-entry.test.js` | 已实现 |
| `FR-003` 会话交互与自动等待回复 | Automation Agent、Codex Adapter、输出分析层 | `src/automation-agent.js`、`src/codex-adapter.js`、`src/output-analysis.js` | `tests/automation-agent.test.js`、`tests/wait-detection.test.js` | 已实现，持续优化 |
| `FR-004` 输出查看与项目文件读取 | 会话输出缓冲层、文件访问层 | `src/session-repository.js`、`src/automation-agent.js`、`src/context-resolver.js` | `tests/automation-agent.test.js` | 已实现 |
| `FR-005` 权限放行与人工干预 | 控制命令层、策略层 | `src/automation-agent.js`、`src/codex-adapter.js`、`src/policy-engine.js` | `tests/automation-agent.test.js`、`tests/codex-adapter.test.js` | 已实现 |
| `FR-006` 历史对话接入、持久化与重启恢复 | 持久化层、历史会话读取层、恢复层 | `src/session-repository.js`、`src/task-repository.js`、`src/source-binding-repository.js`、`src/runtime-recovery.js`、`src/process-cleanup.js` | `tests/repository-persistence.test.js`、`tests/runtime-recovery.test.js`、`tests/codex-adapter.test.js` | 已实现 |
| `FR-007` 状态反馈、列表展示与系统探针 | 列表与通知层、帮助文本生成层、系统探针层 | `src/automation-agent.js`、`src/notifier.js`、`src/telegram-notifier.js`、`src/system-adapter.js` | `tests/automation-agent.test.js`、`tests/system-adapter.test.js` | 已实现 |
| `FR-008` 配置化项目路由与平台驱动抽象 | 配置层、项目发现层、驱动抽象层 | `src/default-config.js`、`src/telegram-entry.js`、`src/wecom-entry.js`、`src/codex-adapter.js` | `tests/telegram-entry.test.js`、`tests/codex-adapter.test.js` | 已实现 |
| `NFR-001` 平台兼容性 | 平台抽象与运行模式设计 | `src/codex-adapter.js`、`src/system-adapter.js` | Windows 自动化验证 | Windows 已验证，macOS 待补 |
| `NFR-002` 交互可靠性 | 等待策略、输出分析、超时分类 | `src/default-config.js`、`src/output-analysis.js`、`src/automation-agent.js` | `tests/automation-agent.test.js`、`tests/wait-detection.test.js` | 已实现，持续优化 |
| `NFR-003` 安全性与最小授权 | 来源白名单、路径白名单、执行档位 | `src/policy-engine.js`、`src/context-resolver.js`、`src/codex-adapter.js` | `tests/automation-agent.test.js`、`tests/codex-adapter.test.js` | 已实现 |
| `NFR-004` 可观测性与恢复性 | 持久化、恢复、服务日志 | `src/*repository.js`、`src/runtime-recovery.js`、`src/file-logger.js` | `tests/repository-persistence.test.js`、`tests/runtime-recovery.test.js` | 已实现 |
| `NFR-005` 可测试性 | 自动化测试体系 | `tests/*.test.js` | `npm test` | 已实现 |
| `NFR-006` 部署可演进性 | 服务入口、配置加载、日志目录 | `src/service-entry.js`、`src/config-loader.js`、`src/file-logger.js` | `tests/service-entry.test.js` | 部分实现 |

## 2026-03-25 更新说明

- `FR-007` 补充 `/help` 为正式用户命令，并要求帮助内容必须反映运行时真实配置
- 实现侧新增 `/help` 分发、帮助文本构建与返回格式化，落点在 `src/automation-agent.js`
- 验证侧新增 `tests/message-parser.test.js` 与 `tests/automation-agent.test.js` 的 `/help` 用例
- 最新整体回归结果：`npm test` => `85/85`



