# codex-puppeteer

`codex-puppeteer` 是一个面向个人使用的远程控制代理，用来把本机的 `Codex CLI` 会话接到聊天端远程操作。

当前主线是 Telegram Bot 控制。你可以在手机上完成项目选择、会话创建、历史对话接续、消息发送、输出查看、目录浏览和文件下载，而不需要远程桌面回到电脑前。

## 项目定位

这个项目解决的不是 VS Code GUI 自动化，也不是模拟点击编辑器里的发送按钮。

它现在走的是更稳定的方式：

1. 在指定项目目录下启动或接管 `Codex CLI`
2. 通过本地进程管理与 Codex 交互
3. 通过 Telegram Bot 接收远程指令
4. 把输出、目录信息和文件附件回传到聊天端

对应到你平时的真实开发流程，就是：

1. 打开命令行
2. 进入项目目录
3. 输入 `codex`
4. 给 Codex 发任务
5. 等结果并继续对话

## 当前能力

- 远程创建新的 Codex 会话
- 接管本机已有的 Codex 历史对话并继续开发
- 在多个项目之间切换当前活动会话
- 发送 prompt，并自动等待当前轮输出后回传
- 查看当前会话最近输出
- 浏览项目目录，进入子目录或返回上级目录
- 搜索文件和目录
- 直接把文件作为 Telegram 附件返回
- 持久化保存会话、任务和来源绑定，便于重启后恢复
- 同时保留 Telegram 和 WeCom 接入层，其中 Telegram 是当前主推荐路径

## 适用场景

- 你平时就是在本机命令行里运行 `codex`
- 你有多个项目，希望在手机上随时切换继续开发
- 你主要看结果和文档，不想频繁远程桌面登录
- 你想把“选项目 -> 选会话 -> 发任务 -> 看结果 -> 读文件”做成一条轻量流程

## 快速开始

### 1. 环境要求

- Node.js 18+
- 本机已安装并可直接执行 `codex`
- 一台长期运行本代理的电脑
- 一个 Telegram Bot Token

### 2. 安装依赖

```bash
npm install
```

### 3. 配置

仓库公开保留了 `.env.example` 作为模板。

运行时会优先读取 `.env`，如果 `.env` 不存在，就自动回退到 `.env.example`。所以首次使用时，你可以直接填写 `.env.example`。

至少需要配置这些参数：

- `TG_BOT_TOKEN`
- `TG_ALLOWED_CHAT_IDS`
- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`

示例：

```env
TG_BOT_TOKEN=123456:xxxxx
TG_ALLOWED_CHAT_IDS=8084968294
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project
```

如果有多个项目根目录，可以使用逗号分隔：

```env
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project,D:\workspace
```

### 4. 启动 Telegram Bot

```bash
npm run tg:bot
```

看到类似输出，就说明轮询已经启动：

```text
Telegram polling bot started.
Allowed chat ids: ...
Allowed project roots: ...
```

## 推荐使用流程

1. 在 Telegram 中发送 `/help`
2. 发送 `/projects`
3. 发送 `/create -n MyTask -w F:\project\MCP`
4. 发送 `/send -n session-0001 -m 请先扫描项目并总结目录结构`
5. 等待自动回复
6. 需要补看进度时发送 `/screen`
7. 需要读文档时用 `/ls`、`/find`、`/read`
8. 需要继续当前会话时，直接发送普通文本
9. 需要切换项目或历史会话时，先 `/list`，再 `/activate`

## 指令说明

### 会话相关

- `/help`
  显示当前可用命令和简要用法。

- `/projects`
  列出允许根目录下的首层项目目录，方便复制路径。

- `/create -n <名称> -w <项目路径>`
  在指定项目目录创建一个新的托管会话。

- `/list`
  同时列出当前托管会话和本机可接管的 Codex 历史对话。

- `/activate -n <编号或sessionId或codexId> [-w <项目路径>]`
  把某个会话切成当前活动会话。之后直接发普通文本，就会继续发到这个会话里。

- `/kill -n <sessionId>`
  终止一个托管会话。

### 对话相关

- `/send -n <目标> -m <内容>`
  向指定会话或历史对话发送消息，并自动等待当前轮输出后回传。

- 直接发送普通文本
  如果当前已经有活动会话，就不需要每次都写 `/send`。

- `/screen`
  查看当前活动会话最近输出，适合补看长任务进度。

### 浏览与读文件

- `/ls`
  列出当前浏览目录内容。

- `/ls -p <编号>`
  进入某个子目录。

- `/ls -p ..`
  返回上一级目录。

- `/find -q <关键词>`
  在当前工作区搜索文件或目录。

- `/read -f <相对路径>`
  读取指定文件，并以 Telegram 附件方式返回。

- `/read -f <编号>`
  直接读取最近一次 `/ls` 或 `/find` 结果中的编号文件。

### 权限模式

- `/enablePermission -n <sessionId>`
  把会话切到自动权限模式，适合远程开发时减少审批阻塞。

- `/disablePermission -n <sessionId>`
  恢复默认权限模式。

### 系统信息

- `/sys`
  查看宿主机和当前代理摘要。

## 关于历史会话

`/list` 会把本机 Codex 的历史对话也列出来。

推荐用法很简单：

1. 先 `/list`
2. 找到想继续的那条历史对话
3. 直接 `/activate -n <编号>` 或 `/send -n <编号> -m 继续上次开发`

这样你就可以继续昨天的开发，也可以在多个项目之间切换。

## 常用脚本

```bash
npm run tg:bot
npm run repl
npm run service
npm run wecom:server
```

说明：

- `tg:bot`：启动 Telegram 轮询机器人
- `repl`：本地命令行调试入口
- `service`：后台服务入口
- `wecom:server`：企业微信接入入口

## 关键配置项

完整配置见 `.env.example`。

常用项：

- `TG_BOT_TOKEN`
- `TG_ALLOWED_CHAT_IDS`
- `TG_DEFAULT_CHAT_ID`
- `TG_API_BASE_URL`
- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
- `CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE`
- `CODEX_PUPPETEER_CODEX_EXEC_PROFILE`
- `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE`
- `CODEX_PUPPETEER_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_STORAGE_DIR`
- `CODEX_PUPPETEER_LOG_DIR`
- `CODEX_PUPPETEER_SYSTEM_MODE`

其中：

- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS` 用来限制可访问的项目根目录
- `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE` 可以设为 `dangerous`，适合个人受信主机远程开发
- `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS` 已针对长任务场景放宽

## 当前状态

- Telegram 主链路可用
- 历史会话接管可用
- 目录浏览、搜索、附件回传可用
- 会话状态持久化已接入
- Windows 是当前优先验证平台
- WeCom 入口仍保留，但不是当前主推荐路径
- 高风险系统动作仍建议保持 `dry-run`

## 公开仓库说明

公开仓库默认包含：

- `README.md`
- `.env.example`
- `src/`
- `agent-specs/`

本地私有资料例如 `docs/`、`.agent/`、`tests/` 不作为公开使用前提，也不会作为公开仓库默认内容。

## 后续可扩展方向

- 增加更多聊天平台接入层
- 做成常驻系统服务
- 完善异常恢复与进程接管
- 优化长任务完成态识别
- 丰富文件浏览与项目导航能力
