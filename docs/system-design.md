# 系统设计文档

## 1. 设计目标与范围

当前设计服务于“Telegram 远程控制 Codex CLI 会话”的主线方案。系统不是 VS Code GUI 自动化工具，而是把以下人工流程抽象成可远程调度的逻辑会话系统：

1. 打开终端。
2. 切换到项目根目录。
3. 输入 `codex`。
4. 持续发送 prompt 并接收回复。

本设计覆盖：

- Telegram 主接入链路与 WeCom 兼容接入。
- 逻辑会话创建、历史对话接入、发送 prompt、查看输出、读取文件、切换活动会话。
- `codex exec --json` 与 `codex exec resume` 主路径。
- 会话、任务、来源绑定持久化与重启恢复。
- Windows 优先的系统适配与可选真实系统动作。

本设计不覆盖：

- VS Code 输入框自动填充与发送按钮点击。
- 任意 Shell 命令远程执行。
- macOS 生产级完整验收结论。

## 2. 需求映射

| 需求编号 | 设计模块 | 说明 |
| --- | --- | --- |
| `FR-001` | 项目上下文解析、会话仓储、Codex 适配层 | 创建并绑定新的逻辑会话 |
| `FR-002` | Telegram/WeCom 接入层、命令解析层、策略层 | 接收、鉴权并路由远程消息 |
| `FR-003` | Automation Agent、Codex Adapter、输出分析层 | `/send` 自动等待与结果判断 |
| `FR-004` | 会话输出缓冲层、文件访问层 | `/screen` 与 `/read` |
| `FR-005` | 控制命令层、策略层 | `/enablePermission` 与 `/kill` |
| `FR-006` | 持久化层、历史会话读取层、恢复层 | attach、resume、重启恢复 |
| `FR-007` | 列表与通知层、系统探针层、系统适配层 | `/list`、`/activate`、`/sys`、通知与系统动作 |
| `FR-008` | 配置层、项目发现层、驱动抽象层 | 白名单目录、运行时配置、驱动选择 |

## 3. 总体架构

系统采用六层结构：

1. 接入层 `Remote Interface`
   - Telegram 为当前主入口。
   - WeCom 为兼容保留入口。
   - 负责接收消息、回传通知、拆分长消息。

2. 命令层 `Parser / Controller`
   - 解析 slash command。
   - 把普通文本路由到当前聊天绑定的活动会话。
   - 执行来源授权与参数校验。

3. 编排层 `Automation Agent`
   - 统一调度会话、任务、通知、系统适配器和 Codex 适配器。
   - 负责 `/send`、`/screen`、`/list`、`/activate` 等核心命令流程。

4. 执行层 `Codex Adapter`
   - 默认主路径为 `exec-json`。
   - 兼容 `pty` 和 `pipe` 驱动，用于排障或平台兼容。
   - 负责创建会话、发送 prompt、恢复历史对话、读取本机 Codex 历史索引。

5. 状态层 `Persistence & Recovery`
   - 保存会话、任务、来源绑定与输出缓冲。
   - 在重启时中断未完成任务，清理或标记残留活跃进程。

6. 适配层 `Notifier / System Adapter / Service`
   - 提供 Telegram/WeCom 通知。
   - 提供系统探针与可选系统动作。
   - 提供常驻服务运行时入口与日志能力。

### 3.1 主数据流

```text
Telegram Update
  -> Telegram Controller
  -> AutomationAgent.receiveText()
  -> Parser / Policy / Context Resolver
  -> Session Repository / Task Repository / Source Binding Repository
  -> Codex Adapter
  -> Output Analysis
  -> Notifier
  -> Telegram Reply
```

## 4. 模块划分

### 4.1 Telegram 接入层

- 责任：轮询更新、解析消息、向自动化代理转发文本、发送回执。
- 输入：Telegram update、bot token、允许的 chat id。
- 输出：统一消息对象、发送结果。
- 依赖：`telegram-client.js`、`telegram-controller.js`、`telegram-notifier.js`、`telegram-entry.js`。

### 4.2 WeCom 兼容接入层

- 责任：处理回调验签、加解密、主动/被动回复。
- 输入：WeCom 回调数据、企业应用配置。
- 输出：统一消息对象、WeCom 回复。
- 依赖：`wecom-*.js`。

### 4.3 命令解析与策略层

- 责任：解析 `/create`、`/list`、`/send` 等命令；校验来源是否授权。
- 输入：消息文本、来源标识、来源绑定信息。
- 输出：标准化命令对象。
- 依赖：`message-parser.js`、`policy-engine.js`。

### 4.4 上下文与项目解析层

- 责任：解析项目别名、允许根目录、文件相对路径与 `/projects` 目录发现。
- 输入：`-w` 参数、白名单目录、项目别名配置、相对文件路径。
- 输出：项目上下文、可读文件请求、项目目录列表。
- 依赖：`context-resolver.js`。

### 4.5 Automation Agent 编排层

- 责任：创建任务、记录事件、分发命令、格式化回复、发送通知、更新会话绑定。
- 输入：标准化命令对象、仓储对象、适配器对象。
- 输出：任务结果、通知事件、会话状态变更。
- 依赖：`automation-agent.js`。

### 4.6 Codex 执行适配层

- 责任：创建会话、发送 prompt、恢复历史会话、读取历史索引、终止进程、读取文件。
- 输入：会话元数据、prompt、驱动模式、工作目录。
- 输出：结构化执行结果、Codex thread id、输出事件、退出事件。
- 依赖：`codex-adapter.js`、本机 `codex` CLI、`node-pty`。

### 4.7 输出分析层

- 责任：区分 assistant 输出、prompt echo、UI 状态行、终端装饰线，辅助判断“当前轮是否完成”。
- 输入：输出缓冲行。
- 输出：`assistantText`、`completionState`、`meaningfulLineCount`、分类结果。
- 依赖：`output-analysis.js`。

### 4.8 状态持久化层

- 责任：保存会话、任务、来源绑定；维护输出 cursor 和缓冲窗口。
- 输入：会话事件、任务事件、输出事件、绑定事件。
- 输出：可恢复的状态快照。
- 依赖：`session-repository.js`、`task-repository.js`、`source-binding-repository.js`、`storage-utils.js`。

### 4.9 恢复与清理层

- 责任：服务启动时恢复状态、清理残留活跃进程、把未完成任务标记为 `interrupted`。
- 输入：持久化状态、运行中进程 pid、平台信息。
- 输出：恢复摘要、会话恢复标记、任务中断标记。
- 依赖：`runtime-recovery.js`、`process-cleanup.js`。

### 4.10 系统适配与服务层

- 责任：返回 `/sys` 系统摘要、执行可选系统动作、提供服务化入口与日志。
- 输入：系统命令、会话统计、环境变量。
- 输出：系统状态、关机计划结果、日志记录。
- 依赖：`system-adapter.js`、`service-entry.js`、`file-logger.js`。

## 5. 核心流程

### 5.1 会话创建流程

1. 接入层收到 `/create -n <name> -w <workspace>`。
2. 策略层校验来源权限；上下文层解析项目路径并校验白名单。
3. 会话仓储创建 `session-000x` 记录，初始状态为 `starting`。
4. Codex 适配层尝试创建或初始化会话。
5. 创建成功后更新会话状态为 `ready` 或 `running`，并把当前聊天绑定到新会话。
6. 通知层回传创建结果。

### 5.2 `/list` 与 `/activate` 流程

1. `/list` 同时读取托管会话和本机 Codex 历史索引。
2. Agent 去重已绑定历史会话，并按“托管会话优先、历史会话随后”的顺序生成编号。
3. 编号映射按聊天来源保存在内存中，后续 `/send -n <number>`、`/screen -n <number>` 可直接复用。
4. `/activate -n <sessionId|listNumber>` 只切换当前聊天绑定，不发送 prompt。

### 5.3 `/send` 自动等待与即时 `/screen` 提示流程

1. 入口收到 `/send -n <sessionId|codexConversationId|listNumber> -m <prompt>`，或收到一条普通文本并根据当前绑定自动转成 `/send`。
2. Agent 解析目标会话，并记录发送前的输出 cursor。
3. Agent 调用 `codexAdapter.sendPrompt()`。
4. 会话绑定立即更新到目标会话。
5. Agent 立即发送一条 `command.screen_hint` 通知，内容为 `screen: /screen -n <sessionId> -c <cursor>`。
6. Agent 进入内部等待循环，轮询输出缓冲和会话状态，默认等待窗口为 `3600000ms`。
7. 输出分析层过滤 prompt echo 和 UI 状态行，提取 assistant 文本并计算完成状态。
8. 最终 `/send` 完成消息只返回 assistant 输出或明确状态结果，不再重复拼接 `/screen` 提示。

### 5.4 历史对话接入与续聊流程

1. 用户可以通过 `/attach`、`/attach-last`，或直接 `/send -n <codexConversationId>` 进入历史会话路径。
2. 如果该历史会话已被托管，则直接复用现有逻辑会话。
3. 如果尚未托管，则基于当前或显式工作区上下文自动创建新的逻辑会话并记录 `codexThreadId`。
4. 之后普通文本或 `/send` 会继续通过 `codex exec resume` 路径续聊。

### 5.5 `/screen` 与 `/read` 流程

1. `/screen` 从会话仓储中读取缓冲输出；如指定 `-c <cursor>`，则只返回该 cursor 之后的新输出。
2. `/read` 通过上下文层校验相对路径必须位于项目根目录内，再调用适配层读取文件内容。
3. 通知层负责处理长消息分片回传。

### 5.6 启动恢复流程

1. 运行时启动后加载会话、任务、来源绑定状态文件。
2. 恢复层遍历仍处于活动状态的会话：
   - 有 pid 时尝试清理残留进程；
   - 没有 pid 时标记为 `recovered_missing`。
3. 所有未完成任务被标记为 `interrupted`。
4. 已处于 `ready` 的逻辑会话可继续用于后续 `/send` 与普通文本续聊。

### 5.7 系统动作流程

1. `/sys` 读取宿主机 CPU、内存、活动会话数和关机计划状态。
2. `/shutdown`、`/cancel_shutdown` 调用系统适配器。
3. 默认模式为 `dry-run`；只有 `CODEX_PUPPETEER_SYSTEM_MODE=real` 时才执行真实系统命令。

## 6. 数据设计

| 实体 | 关键字段 | 说明 |
| --- | --- | --- |
| `SessionDescriptor` | `sessionId`、`projectName`、`projectRoot`、`status`、`driver`、`codexThreadId`、`codexResumeMode`、`outputBuffer` | 逻辑会话主实体 |
| `TaskRecord` | `taskId`、`sourceId`、`commandKey`、`args`、`status`、`response`、`resultSummary`、`events` | 单次命令执行记录 |
| `SourceBinding` | `sourceId`、`sessionId`、`updatedAt` | 当前聊天与活动会话绑定 |
| `OutputLine` | `seq`、`stream`、`line`、`at` | 会话输出缓冲行 |
| `ShutdownPlan` | `mode`、`status`、`armedAt`、`executedAt`、`command` | 系统动作计划状态 |
| `RuntimeConfig` | `security`、`runtime`、`system`、`service`、`telegram`、`wecom` | 统一运行时配置 |

关键约束：

- `sessionId` 必须唯一。
- 项目根目录必须位于允许根目录白名单内。
- 输出缓冲按顺序分配递增 `seq`，支持增量查看。
- 逻辑恢复关注的是会话上下文恢复，而不是正在执行到一半的单次任务续跑。

## 7. 接口设计

### 7.1 命令接口

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| `/create` | 项目名、工作区 | 会话快照、创建结果 |
| `/attach`、`/attach-last` | 历史会话标识、工作区 | 逻辑会话快照 |
| `/projects` | 可选允许根目录过滤 | 项目目录列表 |
| `/list` | 可选历史展开参数 | 托管会话、本机历史会话、编号选择 |
| `/activate` | 会话编号或列表编号 | 当前聊天绑定切换结果 |
| `/send` | 会话标识、prompt | assistant 输出或状态结果、cursor、即时 `/screen` 提示 |
| `/screen` | 会话标识、cursor、行数 | 输出缓冲文本 |
| `/read` | 会话标识、相对路径 | 文件内容 |
| `/enablePermission` | 会话标识 | 权限模式变更结果 |
| `/kill` | 会话标识 | 终止结果 |
| `/sys` | 无 | 宿主机状态摘要 |
| `/shutdown`、`/cancel_shutdown` | 密码或取消动作 | 系统动作计划状态 |

### 7.2 关键配置项

| 配置项 | 说明 |
| --- | --- |
| `TG_BOT_TOKEN` | Telegram Bot token |
| `TG_ALLOWED_CHAT_IDS` | 允许控制的 chat id 列表 |
| `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS` | 允许项目根目录白名单 |
| `CODEX_PUPPETEER_CODEX_CLI` | 可选的 Codex CLI 路径 |
| `CODEX_PUPPETEER_CODEX_MODE` | 驱动模式选择 |
| `CODEX_PUPPETEER_WAIT_TIMEOUT_MS` | 显式等待或补充查看的默认超时 |
| `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS` | `/send` 默认内部等待时间，当前默认 `3600000` |
| `CODEX_PUPPETEER_SYSTEM_MODE` | `dry-run` 或 `real` |
| `CODEX_PUPPETEER_STORAGE_DIR` | 持久化目录 |
| `CODEX_PUPPETEER_LOG_DIR` | 服务日志目录 |

## 8. 非功能设计

- 兼容性：以 Windows 为主验证平台；驱动和系统适配器为跨平台保留扩展点。
- 安全性：来源白名单与目录白名单双重限制；敏感配置仅保留在本地环境文件中。
- 可恢复性：文件持久化与启动恢复配合，确保 ready 会话可继续使用，未完成任务会被安全中断。
- 可观测性：任务事件、通知事件、恢复摘要和系统状态都可查询。
- 可测试性：主要命令路径、适配器、恢复逻辑、Telegram 入口和系统适配均有自动化测试覆盖。

## 9. 风险与权衡

- 权衡：`exec-json` 稳定性优于长期 PTY 注入，但完成态判断仍需结合输出语义分析。
- 权衡：当前采用“逻辑会话恢复”而不是“中途任务续跑”，可以显著降低恢复复杂度和不确定性。
- 风险：复杂真实输出格式变化仍可能影响完成态判断。
- 风险：macOS 尚未完成与 Windows 同等级真实验收。
- 风险：系统真实关机能力已具备适配器，但不应在当前阶段作为主交付能力滥用。

## 10. 待确认事项

- 是否需要为最终用户暴露更细粒度的 `/send` 等待参数。
- Windows 常驻服务最终采用何种部署包装方式，例如 NSSM、计划任务或其他方案。
- 未来是否需要增强对多来源、多用户、共享机器场景的隔离策略。
