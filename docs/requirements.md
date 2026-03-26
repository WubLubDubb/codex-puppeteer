# 需求文档

## 1. 文档概述

- Version: `v1.4.4`
- 创建日期：`2026-03-20`
- 更新日期：`2026-03-26`
- 当前状态：主线方案已经统一为“Telegram 远程控制 Codex CLI 会话”的 Windows 优先版本，WeCom 仅保留为兼容入口。

## 2. 项目背景与目标

本项目面向个人开发者，目标是把“在本机项目目录里打开终端，输入 `codex`，持续对话开发”的人工流程，抽象成一个可以通过手机远程操作的自动化代理。

当前真实目标不是控制 VS Code GUI，也不是点击编辑器发送按钮，而是直接控制本机 `Codex CLI`：

1. 在指定项目根目录下创建或接入一个 Codex 会话。
2. 通过 Telegram 发送 prompt 给该会话。
3. 自动等待当前轮输出，并把结果回传到手机端。
4. 在需要时继续查看输出、读取文件、切换会话、续接历史对话。

成功目标：

- 用户可以通过 Telegram 远程管理多个项目的 Codex 会话。
- 用户可以继续本机已有的 Codex 历史对话，而不必从零开始。
- 用户可以通过 `/help` 快速查看当前系统支持的命令和默认行为。
- `/send` 在常规场景下直接返回当前轮结果，必要时再用 `/screen` 跟进。
- 服务重启后，已持久化的逻辑会话和聊天绑定仍可继续使用。

## 3. 角色与干系人

| 角色 | 关注点 | 当前定位 |
| --- | --- | --- |
| 远程操作用户 | 在手机端发送命令、查看结果、切换项目、续接历史会话 | 核心用户 |
| 本地维护者 | 配置 Bot、白名单目录、运行时参数、日志与部署方式 | 核心维护者 |
| Telegram Bot API | 提供个人可用的远程消息接入与通知回传 | 主接入通道 |
| Codex CLI | 在本机项目目录中执行真实开发会话 | 核心执行对象 |
| 本机操作系统 | 提供进程、文件、目录、系统探针和可选系统动作能力 | 基础环境 |
| WeCom 模块 | 提供可选企业场景兼容入口 | 兼容保留模块 |

## 4. 业务范围

### 4.1 In Scope

- 通过 Telegram 接收文本命令、校验来源、回传结果。
- 在允许的项目根目录下创建新的逻辑 Codex 会话。
- 接入本机已有的 Codex 历史对话，并继续发送 prompt。
- Supports `/help`, `/projects`, `/create`, `/list`, `/activate`, `/send`, `/screen`, `/ls`, `/find`, `/read`, `/enablePermission`, `/disablePermission`, `/kill`, and `/sys` commands.
- 支持会话、任务、来源绑定的本地持久化与重启恢复。
- 支持 `exec-json`、`pty`、`pipe` 等驱动抽象，其中 `exec-json` 为当前主路径。
- Supports remote approval handling through execution profiles: `safe`, `full-auto`, and `dangerous`, with optional sandbox configuration; the current default maps `auto` to `dangerous` to reduce remote approval and network-sandbox blocking.
- 保留系统联动与 WeCom 兼容入口，但不把它们作为当前主交付能力中心。

### 4.2 Out of Scope

- VS Code GUI 自动化，包括输入框填充、按钮点击、窗口元素识别。
- 允许远程执行任意 Shell 命令。
- 未经白名单校验的任意路径读取或项目切换。
- 对 macOS 已达到与 Windows 同等级生产可用性的承诺。
- 把真实关机联动作为当前阶段的主验收目标。

## 5. 功能需求

### 5.1 指令总览

| 指令 | 说明 |
| --- | --- |
| `/help` | 查看当前系统支持的命令、默认行为与配置摘要 |
| `/projects [-w <allowedRoot>]` | 查看允许根目录下的首层项目目录 |
| `/create -n <name> -w <workspace>` | 创建新的逻辑 Codex 会话 |
| `/list [-a] [-c <count>]` | 同时查看托管会话和本机历史会话，并生成编号 |
| `/activate -n <sessionId|codexConversationId|listNumber> [-w <workspace>]` | 切换当前聊天绑定的活动会话；必要时可直接激活本机历史对话 |
| `/send -n <sessionId|codexConversationId|listNumber> -m <prompt>` | 发送 prompt，并自动等待当前轮回复 |
| 直接发送普通文本 | 发给当前聊天已绑定的活动会话 |
| `/screen -n <sessionId|listNumber> [-c <cursor>]` | 查看会话输出或增量输出 |
| `/ls [-n <sessionId|listNumber>] [-p <path|number|..|/>]` | Browse the current directory or enter a numbered directory selection |
| `/find [-n <sessionId|listNumber>] -q <keyword> [-p <path|number|..|/>]` | Search files or directories by name and return reusable numbered results |
| `/read [-n <sessionId|listNumber>] -f <path|number>` | Returns the resolved project file as an attachment, supporting direct paths or the latest browse-result number |
| `/enablePermission -n <sessionId|listNumber>` | Switch the session to auto mode; the current default maps `auto` to `dangerous` |
| `/disablePermission -n <sessionId|listNumber>` | 把会话切回 manual 档位，恢复默认执行策略 |
| `/kill -n <sessionId|listNumber>` | 终止指定会话 |
| `/sys` | 查看宿主机与运行时状态 |
| `/shutdown ...`、`/cancel_shutdown` | 高风险系统动作，当前非主验收路径 |

> 说明：`/wait` 不再是推荐用户指令。当前主流程要求用户以 `/send` 为主交互入口，必要时再用 `/screen` 查看后续输出。

### FR-001 会话创建与项目根目录绑定

- 名称：创建绑定项目根目录的逻辑会话
- 描述：系统必须能够在指定项目根目录下创建一个新的逻辑 Codex 会话，分配唯一 `sessionId`，并记录项目名称、项目根目录、驱动类型、权限模式和当前状态。
- 输入：项目名称、项目根目录或别名、可选运行模式
- 输出：会话编号、项目根目录、创建结果、会话状态
- 前置条件：目标目录位于允许根目录白名单中；本机可调用 `codex`
- 异常情况：路径越界、目录不存在、`codex` 不可用、会话启动失败时必须返回明确错误

### FR-002 远程消息接入、鉴权与路由

- 名称：接收远程命令并路由到自动化控制层
- 描述：系统必须能够接收 Telegram 文本消息，校验 `chat id` 是否允许，解析 slash command，并将普通文本自动路由到当前聊天绑定的活动会话。WeCom 入口可以存在，但不能影响 Telegram 主路径。
- 输入：Telegram update、来源标识、消息文本、允许来源配置
- 输出：标准化命令对象、路由结果、错误回执
- 前置条件：Bot token 与允许来源已正确配置
- 异常情况：来源未授权、命令格式错误、消息类型不支持时必须拒绝并给出提示

### FR-003 会话交互与自动等待回复

- 名称：发送 prompt 并自动等待当前轮结果
- 描述：系统必须支持向指定会话发送 prompt，并在同一条 `/send` 指令内部自动等待当前轮结果。`/send` 启动后应先立即回传一条推荐的 `/screen` 指令，再继续等待；最终完成消息应只聚焦 assistant 输出或状态结果，不重复拼接该 `/screen` 提示。
- 输入：会话编号、Codex 历史会话编号或 `/list` 编号、prompt 文本、等待参数或默认等待策略
- 输出：assistant 文本或状态结果、输出 cursor、完成状态分类、推荐的 `/screen` 指令
- 前置条件：目标会话存在且可发送；若目标是历史会话，则必须能解析到合法项目上下文
- 异常情况：会话不存在、状态不可发送、驱动异常、等待超时或没有完整回复时必须返回明确状态

### FR-004 Output Viewing, Lightweight Browsing, and Project File Reading

- Name: inspect session output, browse project directories, and safely return project files from the bound workspace.
- Description: the system must support buffered output viewing, cursor-based incremental output, lightweight directory browsing for mobile use, name-based file search, and safe file access inside the bound project root.
- Remote delivery model: `/read` returns the resolved project file as an attachment on the Telegram path instead of embedding the whole file body into the chat message.
- Input: session id, cursor, output line limit, browse path or numbered selection, search keyword, and relative file path or numbered file selection.
- Output: screen text, browse list text, numbered search results, latest cursor, file attachment metadata, and clear error details.
- Preconditions: the session exists, the requested path stays inside the project root, and numbered selections come from the latest `/ls` or `/find` result in the same chat/session context.
- Exceptions: empty output, path traversal, missing files, invalid numbered selections, or read failures must return explicit errors.

### FR-005 权限放行与人工干预

- 名称：支持会话权限切换与紧急终止
- Description: the system must support switching session permission mode and terminating a session when needed. Because the remote chain cannot stop at a local Codex approval dialog, `/enablePermission` must affect later `codex exec` arguments through configurable execution profiles. The current default behavior is `auto -> dangerous`, which bypasses approvals and sandbox together.
- 输入：会话编号、权限模式切换命令、终止命令
- 输出：权限模式变更结果、终止结果、更新后的会话状态
- 前置条件：目标会话存在且来源具备控制权限
- 异常情况：会话不存在、状态已终止、切换失败时必须返回明确错误

### FR-006 历史对话接入、持久化与重启恢复

- 名称：续接已有 Codex 对话并在重启后恢复逻辑会话
- 描述：系统必须持久化逻辑会话、任务和来源绑定；支持通过 `/activate -n <codexConversationId|listNumber> [-w <workspace>]` 或 `/send -n <codexConversationId>` 继续本机已有 Codex 历史对话；服务重启时要恢复可继续使用的逻辑会话，并把未完成任务标记为中断。
- 输入：会话元数据、Codex 历史会话编号、持久化文件、启动恢复事件
- 输出：恢复后的会话快照、历史对话绑定结果、中断任务标记结果
- 前置条件：本地状态目录可写；本机存在可读取的 Codex 历史索引时，才能列出本机历史会话
- 异常情况：状态文件损坏、历史会话无效、恢复失败时必须记录并返回明确状态

### FR-007 状态反馈、列表展示与系统探针

- 名称：回传状态并支持多会话远程管理
- 描述：系统必须能够回传任务开始、即时 `/screen` 提示、最终结果、异常错误等通知；支持通过 `/list` 同时查看托管会话和本机历史会话，并支持 `activate` 切换当前聊天绑定会话；支持 `/help` 快速查看当前命令用法；支持 `/sys` 查看宿主机状态。高风险系统动作可保留，但应明确与主控制链路隔离。
- 输入：查询命令、任务事件、系统探针信息
- 输出：列表文本、编号选择、通知文本、系统状态摘要、帮助文本
- 前置条件：通知模块与系统探针可用
- 异常情况：通知发送失败、状态采集失败时必须记录日志并给出降级结果

### FR-008 配置化项目路由与平台驱动抽象

- 名称：通过配置管理项目白名单、驱动策略与运行时参数
- 描述：系统必须允许维护者通过环境变量配置项目根目录白名单、Telegram 参数、Codex CLI 路径、驱动模式、发送等待时间、执行档位、sandbox 策略和系统动作模式等，使不同主机可以复用同一套代码；`/projects` 和 `/help` 应帮助用户发现允许目录、理解当前运行方式并减少手输成本。
- 输入：环境变量、配置文件、宿主机路径差异
- 输出：统一运行时配置对象、配置校验结果、项目发现结果、驱动选择结果
- 前置条件：配置源可访问且内容合法
- 异常情况：配置缺失、路径冲突、驱动不可用或策略不合法时必须拒绝启动或降级运行

## 6. 非功能需求

### NFR-001 平台兼容性

- 类别：兼容性
- 描述：当前交付必须以 Windows 为主验证平台；macOS 保持架构兼容，但在真实验证前不得宣称“已完成生产适配”。
- 验证方式：Windows 主链路自动化测试与本机联调通过；macOS 仅记录为待验证项。

### NFR-002 交互可靠性

- 类别：可靠性
- 描述：`/send` 默认内部等待窗口应足够覆盖长开发任务，当前默认值为 `3600000ms`；等待超时时必须返回可继续追踪的状态，而不是伪装成已完成。
- 验证方式：自动化测试覆盖 `settled`、`timeout`、`ui_only_activity`、历史会话续聊等场景。

### NFR-003 安全性与最小授权

- 类别：安全性
- Description: the system must restrict allowed sources and allowed project roots, and must not expose `.env`, bot tokens, or sensitive secrets in remote replies or commits. `dangerous` bypasses both approvals and sandbox; because `auto` now defaults to `dangerous`, this mode must only be used on trusted hosts and whitelisted projects.
- 验证方式：来源校验、路径越界测试、推送前 `.gitignore` 与工作区检查。

### NFR-004 可观测性与恢复性

- 类别：可维护性
- 描述：系统必须持久化关键会话、任务和绑定数据，记录恢复事件，并在重启时清理残留活跃进程或标记异常状态。
- 验证方式：持久化测试、运行时恢复测试、日志与状态文件检查。

### NFR-005 可测试性

- 类别：可维护性
- 描述：核心控制链路必须具备自动化测试覆盖，包括命令解析、Codex 适配层、持久化、恢复、Telegram 入口与系统适配。
- 验证方式：`npm test` 通过，并保持关键功能有对应测试文件。

### NFR-006 部署可演进性

- 类别：部署
- 描述：系统应支持作为常驻服务运行，并具备日志目录、环境加载、错误通知和未来服务化包装扩展点。
- 验证方式：存在服务入口与运行时配置层，剩余生产化事项在计划和状态文档中明确记录。

## 7. 约束与假设

- 当前主入口默认是 Telegram，WeCom 仅作为保留兼容模块。
- 所有真实项目目录必须位于 `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS` 白名单中。
- 本机必须已安装并可调用 `codex`，必要时可通过 `CODEX_PUPPETEER_CODEX_CLI` 指定路径。
- 后台逻辑会话不等同于用户肉眼可见的终端黑框窗口。
- `/send` 是推荐主交互命令，`/screen` 负责补充查看输出；`/wait` 已退役为用户主流程。
- The remote-control chain cannot pause on a local approval dialog, so policy must be decided in advance through `/enablePermission` or execution-profile environment variables; the current default `auto` path is `dangerous`.
- 默认系统模式应保持 `dry-run`，除非维护者显式配置为 `real`。

## 8. 风险与待确认事项

- assistant 完成态仍依赖输出语义分析，在复杂真实会话下仍可能需要继续调优。
- macOS 尚未完成与 Windows 同等级的真实验证。
- Windows 常驻服务、异常告警和长期后台运维方案仍需继续加强。
- 真正的系统联动虽已有适配器与真实模式，但不建议在当前阶段作为主验证路径。

## 9. 验收标准

### AC-001

- 对应需求：`FR-001`
- 验收条件：可以在允许目录下创建新的逻辑会话，并返回 `sessionId`、项目路径和会话状态。
- 验收方式：执行 `/create` 并检查结果和持久化状态。

### AC-002

- 对应需求：`FR-002`
- 验收条件：Telegram 合法来源消息可以被正确接收、解析和路由；非法来源会被拒绝。
- 验收方式：自动化测试和本地运行时联调。

### AC-003

- 对应需求：`FR-003`
- 验收条件：`/send` 能返回当前轮 assistant 输出或明确状态结果；开始时会单独给出 `/screen` 提示；默认等待窗口支持长任务。
- 验收方式：自动化测试覆盖 `settled`、`timeout`、延迟输出和即时 `screen hint` 通知。

### AC-004

- Related requirement: `FR-004`
- Acceptance condition: `/screen` supports full and incremental output viewing, `/ls` and `/find` support numbered mobile browsing, and `/read` only returns files inside the project root as attachments.
- Verification: automated tests plus project-root boundary validation.
### AC-005

- 对应需求：`FR-005`
- Acceptance condition: `/enablePermission` and `/kill` must correctly change session state; the next `/send` after `/enablePermission` must use the execution profile mapped from `auto`, which now defaults to `dangerous`.
- 验收方式：自动化测试验证状态切换、执行档位切换和终止结果。

### AC-006

- 对应需求：`FR-006`
- 验收条件：系统重启后可以恢复已持久化会话；可以通过 `/activate` 或 `/send` 直接继续历史对话。
- 验收方式：持久化与恢复自动化测试。

### AC-007

- 对应需求：`FR-007`
- 验收条件：`/list` 能同时展示托管会话与本机历史会话，并支持编号操作；`/activate` 能切换当前聊天绑定会话；`/help` 能输出真实可用的命令用法；`/sys` 能返回系统摘要。
- 验收方式：自动化测试与实际消息回传检查。

### AC-008

- 对应需求：`FR-008`
- 验收条件：不同主机可通过配置切换允许根目录、Bot 参数、Codex CLI 路径、等待策略和执行档位；`/projects` 可列出允许目录下的项目目录。
- 验收方式：环境变量配置测试、`/projects`/`/help` 自动化测试与启动验证。



