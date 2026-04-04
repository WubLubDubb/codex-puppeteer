# codex-puppeteer

`codex-puppeteer` 是一个通过 Telegram 远程控制本机 `Codex CLI` 的代理工具。

它面向个人和小规模自托管场景，核心能力是把本地的 Codex 会话接到聊天端，让你可以远程创建会话、继续历史对话、发送开发任务、查看输出、浏览目录和下载项目文件。

## 功能特性

- 创建新的 Codex 会话
- 接管本机已有的 Codex 历史会话
- 远程发送 prompt，并自动等待当前轮输出
- 查看当前会话最近输出
- 浏览项目目录，进入子目录或返回上级目录
- 搜索文件和目录
- 将文件作为 Telegram 附件返回
- 持久化保存会话、任务和聊天绑定关系
- 重启后恢复运行状态

## 适用场景

- 你平时就在本机命令行中使用 `codex`
- 你希望在手机上远程推进多个项目
- 你主要看结果和文档，不想频繁远程桌面登录
- 你想把“选项目 -> 发任务 -> 看结果 -> 读文件”做成轻量工作流

## 系统要求

- Node.js 18+
- 本机已安装并可直接执行 `codex`
- Windows、macOS 或 Linux
- 一个 Telegram Bot Token

安装完成后，建议先在终端确认：

```bash
codex --version
```

## 安装

```bash
npm install
```

## 配置

仓库提供了 [`.env.example`](/f:/Project/codex-puppeteer/.env.example) 作为模板。

运行时会优先读取 `.env`；如果 `.env` 不存在，则自动回退到 `.env.example`。  
调试时可以直接编辑 `.env.example`，正式部署建议复制成 `.env` 再填写。

### 最小配置

```env
TG_BOT_TOKEN=你的机器人Token
TG_ALLOWED_CHAT_IDS=你的Telegram数字chat_id
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project
```

如果你有多个项目根目录，可以用逗号分隔：

```env
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project,D:\workspace
```

### 常用配置项

- `TG_BOT_TOKEN`
- `TG_ALLOWED_CHAT_IDS`
- `TG_DEFAULT_CHAT_ID`
- `TG_API_BASE_URL`
- `TG_POLL_INTERVAL_MS`
- `TG_LONG_POLL_TIMEOUT_SEC`
- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
- `CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE`
- `CODEX_PUPPETEER_CODEX_EXEC_PROFILE`
- `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE`
- `CODEX_PUPPETEER_CODEX_SANDBOX`
- `CODEX_PUPPETEER_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_STORAGE_DIR`
- `CODEX_PUPPETEER_SYSTEM_MODE`

### 权限模式建议

远程控制场景常见配置：

```env
CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE=manual
CODEX_PUPPETEER_CODEX_EXEC_PROFILE=safe
CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE=dangerous
```

含义：

- `manual + safe`：默认保留审批行为
- `auto + dangerous`：开启自动权限后绕过审批和沙箱，适合完全受信任的个人主机

## 运行数据

默认会在本地生成：

- `.agent/runtime/`

其中通常会包含：

- `sessions.json`
- `tasks.json`
- `source-bindings.json`

这些文件用于恢复会话、任务状态和聊天绑定关系，部署时建议保留。

## 快速部署

### 启动 Telegram 机器人

```bash
npm run tg:bot
```

启动成功后，终端通常会输出：

```text
Telegram polling bot started.
Allowed chat ids: ...
Allowed project roots: ...
Sessions file: ...
Tasks file: ...
Source bindings file: ...
```

此时即可在 Telegram 中给机器人发送命令。

### 推荐部署方式

Windows：

1. 把项目放到稳定目录
2. 使用 `.env` 保存正式配置
3. 先手动运行 `npm run tg:bot` 验证
4. 稳定后再接入任务计划程序、NSSM 或其他守护方式常驻运行

macOS / Linux：

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
  创建新的托管会话。

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
  查看宿主机和代理摘要。

## 首次使用示例

1. `/help`
2. `/projects`
3. `/create -n MyTask -w F:\project\MCP`
4. `/send -n session-0001 -m 请先扫描项目并总结目录结构`
5. `/screen`
6. `/ls`
7. `/read -f README.md`

之后如果继续当前会话，可以直接发送普通文本，不需要每次都写 `/send`。

## 历史会话接续

`/list` 会同时显示：

- 当前托管会话
- 本机 Codex 可恢复的历史会话

例如：

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
npm run repl
npm run test
```

说明：

- `tg:bot`：启动 Telegram 轮询机器人
- `repl`：本地调试入口
- `test`：运行公开仓库测试入口

## 运维建议

- 使用独立账号和独立主机运行
- 只放开必要的 `TG_ALLOWED_CHAT_IDS`
- 严格限制 `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
- 正式环境优先使用 `.env`，不要提交真实密钥
- 保留 `.agent/runtime/` 目录，避免丢失会话恢复能力
- 高风险系统动作保持 `CODEX_PUPPETEER_SYSTEM_MODE=dry-run`

## 常见问题

### 1. 机器人启动后没有响应

优先检查：

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

这是为了更适合在移动端查看 Markdown、配置文件和文档，避免长文本直接塞满聊天窗口。

## 安全说明

本项目具备远程执行和会话控制能力，部署时请务必注意：

- 不要泄露 Telegram Bot Token
- 不要把允许访问的项目根目录配置得过大
- 不要在不受信任的主机上使用 `dangerous` 执行档
- 在确认风险前，保持系统动作处于 `dry-run`

## License

如果你计划正式开源发布，建议补充许可证文件，例如 `MIT`。
