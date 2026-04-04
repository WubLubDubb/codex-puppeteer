# codex-puppeteer

`codex-puppeteer` 是一个面向开源用户的远程开发代理，用来把本机的 `Codex CLI` 会话接入聊天端，实现远程发起任务、接续会话、查看输出、浏览项目文件和下载文档。

当前仓库提供两类接入方式：

- Telegram Bot
- 企业微信回调服务

如果你是个人使用，推荐优先部署 Telegram 版本。

## 功能概览

- 在指定项目目录创建新的 Codex 会话
- 接管本机已有的 Codex 历史对话并继续开发
- 远程发送 prompt，并自动等待当前轮输出
- 查看会话最近输出和任务进度
- 浏览项目目录，进入子目录或返回上级目录
- 搜索文件或目录
- 直接把文件作为聊天附件返回
- 持久化保存会话、任务和聊天来源绑定
- 进程重启后恢复运行状态

## 适用场景

- 你在本机通过 `codex` 进行日常开发
- 你希望在手机上远程操作多个项目
- 你需要查看项目文档、README、部署说明或配置文件
- 你希望把“选项目 -> 发任务 -> 看结果 -> 读文件”做成一条轻量工作流

## 系统要求

- Node.js 18 或更高版本
- 本机已安装并可直接执行 `codex`
- Windows、macOS 或 Linux
- 一个可用的 Telegram Bot Token，或一套企业微信回调配置

## 安装

```bash
npm install
```

安装完成后，建议先在终端确认本机可以直接运行：

```bash
codex --version
```

如果命令不可用，需要先完成 Codex CLI 的本地安装与登录。

## 配置

仓库提供了 [`.env.example`](/f:/Project/codex-puppeteer/.env.example) 作为配置模板。

运行时会优先读取 `.env`；如果 `.env` 不存在，则回退到 `.env.example`。  
开发调试可以直接编辑 `.env.example`，正式部署建议复制为 `.env` 再填写。

### Telegram 最小配置

至少需要配置以下变量：

```env
TG_BOT_TOKEN=你的机器人Token
TG_ALLOWED_CHAT_IDS=你的Telegram数字chat_id
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project
```

如果需要允许多个项目根目录，可以用逗号分隔：

```env
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project,D:\workspace
```

### 常用运行配置

- `TG_BOT_TOKEN`
- `TG_ALLOWED_CHAT_IDS`
- `TG_DEFAULT_CHAT_ID`
- `TG_API_BASE_URL`
- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
- `CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE`
- `CODEX_PUPPETEER_CODEX_EXEC_PROFILE`
- `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE`
- `CODEX_PUPPETEER_CODEX_SANDBOX`
- `CODEX_PUPPETEER_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_STORAGE_DIR`
- `CODEX_PUPPETEER_LOG_DIR`
- `CODEX_PUPPETEER_SYSTEM_MODE`

### 执行权限建议

远程控制场景常用两组配置：

```env
CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE=manual
CODEX_PUPPETEER_CODEX_EXEC_PROFILE=safe
CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE=dangerous
```

含义如下：

- `manual + safe`：默认保留审批行为，适合更保守的环境
- `auto + dangerous`：在启用自动权限后绕过审批和沙箱，适合完全受信任的个人主机

如果你计划把主机长期暴露给远程命令使用，建议优先限制 `TG_ALLOWED_CHAT_IDS` 和 `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`。

## 目录与运行数据

默认情况下，程序会在本地生成以下运行目录：

- `.agent/runtime/`
- `.agent/logs/`

其中通常会保存：

- `sessions.json`
- `tasks.json`
- `source-bindings.json`

这些文件用于恢复会话、任务状态和当前聊天绑定关系。部署时建议保留，不要随意清空。

## 快速部署

### 方案一：Telegram 轮询机器人

这是最简单的部署方式，适合个人使用。

1. 安装依赖
2. 填写 `.env` 或 `.env.example`
3. 确保本机命令行可以直接执行 `codex`
4. 启动：

```bash
npm run tg:bot
```

启动成功后，终端通常会输出类似信息：

```text
Telegram polling bot started.
Allowed chat ids: ...
Allowed project roots: ...
Sessions file: ...
Tasks file: ...
Source bindings file: ...
```

此时即可在 Telegram 中给机器人发送命令。

### 方案二：企业微信回调服务

如果你使用企业微信，可启动回调服务器：

```bash
npm run wecom:server
```

你需要额外配置企业微信相关参数，例如：

- `WECOM_TOKEN`
- `WECOM_ENCODING_AES_KEY`
- `WECOM_RECEIVE_ID`
- `WECOM_CORP_ID`
- `WECOM_CORP_SECRET`
- `WECOM_AGENT_ID`

### 方案三：企业微信托管服务模式

如果你希望使用带持久化、日志和恢复能力的托管服务入口，可使用：

```bash
npm run service
```

该入口会使用本地文件仓库、日志目录和异常恢复逻辑，更适合长期运行。

## 推荐部署方式

### Windows

推荐做法：

1. 把项目放到稳定目录
2. 使用 `.env` 保存正式配置
3. 先手动运行 `npm run tg:bot` 验证
4. 稳定后再接入任务计划程序、NSSM 或其他守护方式常驻运行

### macOS / Linux

推荐做法：

1. 使用 `.env` 保存正式配置
2. 先手动运行 `npm run tg:bot`
3. 再接入 `pm2`、`systemd`、`launchd` 或其他进程守护工具

## 常用命令

### 会话管理

- `/help`
  查看帮助和当前运行配置摘要。

- `/projects`
  列出允许根目录下的项目文件夹。

- `/create -n <名称> -w <项目路径>`
  创建一个新的托管会话。

- `/list`
  查看当前托管会话和本机可接管的 Codex 历史对话。

- `/activate -n <编号或sessionId或codexId> [-w <项目路径>]`
  将某个会话切换为当前聊天的活动会话。

- `/kill -n <sessionId>`
  终止一个托管会话。

### 对话交互

- `/send -n <目标> -m <内容>`
  向指定会话或历史对话发送消息，并自动等待当前轮输出。

- 直接发送普通文本
  如果当前聊天已经绑定活动会话，可直接继续对话。

- `/screen`
  查看当前活动会话最近输出，适合补看长任务进度。

### 文件浏览

- `/ls`
  查看当前浏览目录内容。

- `/ls -p <编号>`
  进入某个子目录。

- `/ls -p ..`
  返回上一级目录。

- `/find -q <关键词>`
  搜索文件或目录。

- `/read -f <相对路径>`
  读取指定文件，并以聊天附件方式返回。

- `/read -f <编号>`
  读取最近一次 `/ls` 或 `/find` 结果中的编号文件。

### 权限与系统

- `/enablePermission -n <sessionId>`
  将会话切到自动权限模式。

- `/disablePermission -n <sessionId>`
  恢复默认权限模式。

- `/sys`
  查看宿主机和代理的摘要信息。

## 首次使用示例

推荐从下面这组命令开始：

1. `/help`
2. `/projects`
3. `/create -n MyTask -w F:\project\MCP`
4. `/send -n session-0001 -m 请先扫描项目并总结目录结构`
5. `/screen`
6. `/ls`
7. `/read -f README.md`

如果之后还想继续当前会话，可以直接发送普通文本，无需每次都写 `/send`。

## 历史会话接续

`/list` 会同时展示两类内容：

- 当前系统已经托管的会话
- 本机 Codex 可恢复的历史对话

你可以通过以下方式继续之前的工作：

```text
/list
/activate -n 3
继续上次的开发
```

或者：

```text
/send -n 3 -m 继续上次的开发
```

## 常用脚本

```bash
npm run tg:bot
npm run wecom:server
npm run service
npm run repl
```

说明：

- `tg:bot`：启动 Telegram 轮询机器人
- `wecom:server`：启动企业微信回调服务
- `service`：启动带日志、恢复和持久化能力的托管服务入口
- `repl`：本地调试入口

## 运维建议

- 使用独立账号和独立主机运行
- 仅放开必要的 `TG_ALLOWED_CHAT_IDS`
- 严格限制 `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
- 生产环境优先使用 `.env`，不要直接提交真实密钥
- 保留 `.agent/runtime/` 目录，避免丢失会话恢复能力
- 对高风险系统动作保持 `CODEX_PUPPETEER_SYSTEM_MODE=dry-run`

## 常见问题

### 1. 机器人启动后没有响应

请优先检查：

- `TG_BOT_TOKEN` 是否正确
- `TG_ALLOWED_CHAT_IDS` 是否包含当前聊天 ID
- 本机是否能正常访问 Telegram API
- 终端中是否出现轮询报错信息

### 2. 发送命令后 Codex 无法启动

请检查：

- 本机命令行是否可以直接执行 `codex`
- 项目路径是否在 `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS` 允许范围内
- 当前用户是否有目标目录访问权限

### 3. 为什么重启后还能看到之前的会话

因为程序默认会把会话、任务和聊天绑定关系保存在 `.agent/runtime/` 中，用于恢复运行状态。

### 4. 为什么读取文件时返回的是附件

这是为了更适合在移动端查看文档、Markdown 和配置文件，避免长文本直接塞满聊天窗口。

## 安全说明

本项目具备远程执行和会话控制能力，部署时请务必注意：

- 不要泄露机器人 Token 或企业微信凭据
- 不要把允许访问的项目根目录配置得过大
- 不要在不受信任的主机上使用 `dangerous` 执行档
- 在确认风险前，保持系统动作处于 `dry-run`

## License

如果你计划正式开源发布，建议补充项目许可证文件，例如 `MIT`。
