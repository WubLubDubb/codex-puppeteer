# codex-puppeteer

`codex-puppeteer` 是一个把 `Codex CLI` 远程化的个人代理系统。

它的核心目标很简单：你不需要坐在电脑前，只要通过 Telegram Bot，就可以在手机上远程选择项目、创建或接管 Codex 会话、发送开发任务、查看输出、浏览目录、下载文件，并持续推进同一个项目开发流程。

当前主线已经从“VS Code GUI 自动化”收敛到“直接调度 Codex CLI”。这也是现在更稳定、适配性更好的方案。

## 项目能力

- 远程创建新的 Codex 会话
- 接管本机已有的 Codex 历史对话并继续开发
- 在多个项目之间切换当前活动会话
- 发送 prompt，并自动等待当前轮输出后回传到 Telegram
- 查看当前会话屏幕输出
- 浏览项目目录、进入子目录、返回上级目录
- 搜索文件或目录
- 直接把文件作为 Telegram 附件返回，适合查看 `README.md`、需求文档、部署说明等
- 持久化保存会话、任务、来源绑定等运行状态，便于重启后恢复
- 支持 Telegram 和 WeCom 两套接入层，其中 Telegram 是当前个人使用主路径

## 适用场景

- 你平时在本机命令行里通过 `codex` 做开发，希望把这套流程远程化
- 你有多个项目目录，希望在手机上随时切换项目并继续之前的对话
- 你主要看文档和结果，不想频繁远程桌面登录电脑
- 你希望把“项目选择 -> 会话选择 -> 发送任务 -> 看结果 -> 读文档”串成一条轻量链路

## 当前工作方式

这个项目不是去点击 VS Code 窗口里的按钮。

它现在的实现方式是：

1. 在指定项目目录下启动或接管 `Codex CLI`
2. 通过本地进程管理与 Codex 交互
3. 通过 Telegram Bot 接收远程指令
4. 把 Codex 输出、目录信息、文件附件回传到 Telegram

也就是说，它模拟的是你平时这条真实流程：

1. 打开命令行
2. `cd` 到项目目录
3. 输入 `codex`
4. 给 Codex 发任务
5. 等待结果

## 核心架构

- 接入层：Telegram / WeCom
- 控制层：命令解析、来源绑定、活动会话切换、输出回传
- 执行层：Codex CLI 进程管理、历史会话接管、状态持久化、异常恢复

## 快速开始

### 1. 环境要求

- Node.js 18+
- 本机已安装并可直接执行 `codex`
- 一台可以长期运行该代理的电脑
- 一个 Telegram Bot Token

### 2. 安装依赖

```bash
npm install
```

### 3. 配置

本项目公开仓库保留了 `.env.example` 作为可直接填写的模板。

运行时会优先读取 `.env`，如果 `.env` 不存在，则自动回退到 `.env.example`。  
所以你可以直接修改 `.env.example` 先跑起来，后续再按需要拆分为 `.env`。

至少需要填写这些参数：

- `TG_BOT_TOKEN`
- `TG_ALLOWED_CHAT_IDS`
- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`

示例：

```env
TG_BOT_TOKEN=123456:xxxxx
TG_ALLOWED_CHAT_IDS=8084968294
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project
```

如果你有多个项目目录根，可以写成逗号分隔：

```env
CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS=F:\project,D:\workspace
```

### 4. 启动 Telegram Bot

```bash
npm run tg:bot
```

看到类似输出就表示轮询已经启动：

```text
Telegram polling bot started.
Allowed chat ids: ...
Allowed project roots: ...
```

## 推荐使用流程

在 Telegram 中，推荐按这个顺序使用：

1. `/help`
2. `/projects`
3. `/create -n MyTask -w F:\project\MCP`
4. `/send -n session-0001 -m 请先扫描项目并总结目录结构`
5. 等待自动回复
6. 需要更多上下文时用 `/screen`
7. 需要看文档时用 `/ls`、`/find`、`/read`
8. 想继续同一个会话时，直接发送普通文本
9. 想切换到另一个项目或历史会话时，先用 `/list`，再用 `/activate`

## 指令说明

### 会话相关

- `/help`
  显示当前实际可用命令和简要用法。

- `/projects`
  查看允许根目录下的项目文件夹列表，方便创建会话时复制路径。

- `/create -n <名称> -w <项目路径>`
  在指定项目目录创建一个新的托管会话。

- `/list`
  同时列出两类内容：
  - 当前系统已经托管的会话
  - 本机可接管的 Codex 历史对话

- `/activate -n <编号或sessionId或codexId> [-w <项目路径>]`
  把某个会话切成当前活动会话。之后你直接发普通文本，就会发到这个会话里。

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
  查看宿主机和当前代理的一些摘要信息。

## 关于历史会话

`/list` 会把本机 Codex 的历史对话也列出来。

你不需要单独记复杂的新指令，当前推荐方式就是：

1. 先 `/list`
2. 找到想接续的那条历史对话
3. 直接 `/activate -n <编号>` 或 `/send -n <编号> -m 继续上次开发`

这意味着：

- 你可以继续昨天的开发
- 你可以在多个项目之间切换
- 你可以把“托管会话”和“历史对话”放在一套入口里管理

## 常用脚本

```bash
npm run tg:bot
npm run repl
npm run service
npm run wecom:server
npm test
```

说明：

- `tg:bot`：启动 Telegram 轮询机器人
- `repl`：本地命令行调试入口
- `service`：后台服务入口
- `wecom:server`：企业微信接入入口
- `test`：运行自动化测试

## 关键配置项

完整配置见 `.env.example`。

常用项如下：

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
- `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE` 默认可设为 `dangerous`，适合个人受信主机远程开发
- `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS` 默认已经放宽到长任务场景

## 当前状态

- Telegram 主链路可用
- 历史会话接管可用
- 目录浏览、搜索、附件回传可用
- 会话状态持久化已接入
- Windows 是当前优先验证平台
- WeCom 入口仍保留，但不是当前主推荐路径
- 高风险系统动作仍建议保持 `dry-run`

## 测试

当前仓库包含自动化测试，运行：

```bash
npm test
```

最近一次基线为：

```text
95/95 passing
```

## 开源说明

这个仓库适合作为个人远程 Codex 控制代理的基础版本。

公开仓库默认包含：

- `README.md`
- `.env.example`
- `src/`
- `tests/`
- `agent-specs/`

本地私有资料例如 `docs/`、`.agent/` 不作为公开使用前提。

## 后续可扩展方向

- 增加更多聊天平台接入层
- 做成常驻系统服务
- 完善异常恢复与进程接管
- 优化长任务完成态识别
- 丰富文件浏览与项目导航能力
