# 开发计划

## 1. 计划目标

当前计划目标是围绕“Telegram 远程控制 Codex CLI 会话”这条主线，把代码、文档、测试和部署路径统一到同一套口径上：

- 主入口：`Telegram Bot`
- 主执行对象：`Codex CLI`
- 主交互方式：`/send` 自动等待当前轮回复，`/screen` 补充查看输出
- 主辅助入口：`/help` 用于手机端快速查命令
- 主交付平台：`Windows`
- 主恢复能力：逻辑会话持久化、重启后继续已有对话

## 2. 当前阶段结论

### 2.1 已完成

- Telegram 轮询入口、消息控制器、通知器与运行时配置
- `Codex CLI` 主路径接入，支持 `codex exec --json` 与 `codex exec resume`
- 可配置执行档位与可选 sandbox 覆盖
- `/help`、`/projects`、`/create`、`/list`、`/activate`、`/send`、`/screen`、`/read`、`/attach -i`、`/attach -last`、`/enablePermission`、`/kill`、`/sys`
- `/list` 编号选择、历史会话聚合、普通文本自动路由到活动会话
- 会话、任务、来源绑定持久化，以及运行时恢复
- `/send` 单独即时 `/screen` 提示、1 小时默认等待窗口、输出语义分类优化
- 自动化测试 `85/85` 通过

### 2.2 进行中

- assistant 完成态识别的持续调优
- Windows 常驻服务与部署硬化
- 运行日志、状态摘要和验收证据的持续整理

### 2.3 暂缓或后置

- macOS 真实环境验证
- 高风险系统联动的生产级验收

## 3. 工作拆解结构

| 任务编号 | 对应需求 | 模块 | 任务说明 | 主要产物 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `TASK-101` | `FR-001` | 会话创建、上下文解析 | 通过白名单目录或别名创建逻辑会话 | `src/automation-agent.js`、`src/context-resolver.js` | 已完成 |
| `TASK-102` | `FR-002` | Telegram 接入 | 建立 Telegram 轮询、消息路由、回执能力 | `src/telegram-*.js` | 已完成 |
| `TASK-103` | `FR-003` | 发送与等待 | 实现 `/send` 自动等待、结果判定、即时 `/screen` 提示 | `src/automation-agent.js`、`src/output-analysis.js` | 已完成 |
| `TASK-104` | `FR-004` | 输出与文件访问 | 支持 `/screen`、`/read`、cursor 增量查看 | `src/session-repository.js`、`src/automation-agent.js` | 已完成 |
| `TASK-105` | `FR-005` | 权限与干预 | 支持权限切换与终止会话 | `src/policy-engine.js`、`src/automation-agent.js` | 已完成 |
| `TASK-106` | `FR-006` | 持久化与恢复 | 会话、任务、来源绑定落盘与恢复 | `src/*repository.js`、`src/runtime-recovery.js` | 已完成 |
| `TASK-107` | `FR-006` | 历史对话续聊 | 支持 `/attach -i`、`/attach -last`、直接历史会话编号续聊 | `src/codex-adapter.js`、`src/automation-agent.js` | 已完成 |
| `TASK-108` | `FR-007` | 列表与通知 | 支持 `/list` 聚合展示、编号模式、通知回传 | `src/automation-agent.js`、`src/telegram-notifier.js` | 已完成 |
| `TASK-109` | `FR-007` | 帮助文本 | 支持 `/help`，并根据当前配置生成实际帮助内容 | `src/automation-agent.js`、测试 | 已完成 |
| `TASK-110` | `FR-008` | 配置层 | 支持白名单目录、等待参数、驱动与系统模式配置 | `src/default-config.js`、`src/telegram-entry.js` | 已完成 |
| `TASK-111` | `NFR-004` | 服务与日志 | 常驻服务、日志目录、异常通知、环境加载 | `src/service-entry.js`、`src/file-logger.js` | 进行中 |
| `TASK-112` | `FR-003` | 完成态识别 | 继续增强复杂输出场景下的结果判定 | `src/output-analysis.js`、测试 | 进行中 |
| `TASK-113` | `NFR-001` | 跨平台验证 | 补齐 macOS 真实环境验证与文档回写 | 文档、测试记录 | 待开始 |
| `TASK-114` | `NFR-006` | 文档治理 | 同步需求、设计、计划、验收、变更日志和状态摘要 | `docs/*.md`、`.agent/*.md` | 已完成 |

## 4. 里程碑

| 里程碑 | 目标 | 完成条件 | 当前状态 |
| --- | --- | --- | --- |
| `M1` | 核心远程控制打通 | 可以远程创建、发送、查看、读取、终止会话 | 已完成 |
| `M2` | 历史会话与恢复 | 支持 attach、resume、重启后继续已有逻辑会话 | 已完成 |
| `M3` | 用户交互简化 | `/send` 自动等待，普通文本续聊，`/activate` 切换活动会话 | 已完成 |
| `M4` | 帮助与可发现性 | `/help`、`/projects`、`/list` 让手机端可直接发现命令和项目 | 已完成 |
| `M5` | 文档与测试统一 | 核心文档、README、状态摘要、自动化测试口径一致 | 已完成 |
| `M6` | 服务化硬化 | 补齐常驻服务、日志、异常通知与部署说明 | 进行中 |
| `M7` | 跨平台扩展 | 完成 macOS 真实验证并回写结果 | 待开始 |

## 5. 验证检查点

| 检查点 | 当前状态 | 验证方式 |
| --- | --- | --- |
| 命令解析正确性 | 通过 | `tests/message-parser.test.js` |
| `/help` 运行时帮助内容 | 通过 | `tests/automation-agent.test.js` |
| `/send` 自动等待与通知时序 | 通过 | `tests/automation-agent.test.js` |
| 历史会话续聊 | 通过 | `tests/automation-agent.test.js`、`tests/codex-adapter.test.js` |
| 持久化与重启恢复 | 通过 | `tests/repository-persistence.test.js`、`tests/runtime-recovery.test.js` |
| Telegram 运行时与配置加载 | 通过 | `tests/telegram-entry.test.js`、`tests/telegram-client.test.js` |
| 执行档位与远程放行策略 | 通过 | `tests/codex-adapter.test.js`、`tests/automation-agent.test.js` |
| 系统适配器基础路径 | 通过 | `tests/system-adapter.test.js` |

## 6. 风险与依赖

### 高优先级

- 继续优化 assistant 完成态识别，减少复杂真实开发任务下的误判
- 完善 Windows 常驻服务部署与异常告警说明

### 中优先级

- 梳理生产运行时日志、服务重启策略和配置样板
- 为更多真实 Telegram 长任务联调补充经验文档

### 低优先级

- macOS 深度验证
- 真实系统关机联动的生产级验收

## 7. 交付物

- 核心实现代码：`src/`
- 自动化测试：`tests/`
- 需求、设计、计划、验收文档：`docs/`
- 运行状态与追踪摘要：`.agent/`
- 环境模板与使用说明：`.env.example`、`README.md`

## 8. 完成定义

当前计划阶段可视为达成的标准：

1. Windows 下的 Telegram 远程控制主链路可用
2. 逻辑会话、历史会话续聊、持久化与恢复已落地
3. `/help`、`/send`、`/screen`、`/list`、`/activate` 等核心交互已统一到文档、实现和测试中
4. 自动化测试通过，且剩余未完成事项被明确记录为后续工作，而不是混入“已交付”描述中
