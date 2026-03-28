# codex-puppeteer

## 项目定位

`codex-puppeteer` 是一个面向个人使用的远程控制代理，当前主线是：通过 Telegram Bot 远程控制本机的 `Codex CLI` 会话。

它解决的问题不是 VS Code GUI 自动化，也不是点击编辑器里的发送按钮，而是把你平时这套人工流程远程化：

1. 进入某个项目根目录
2. 启动或接上一个 Codex 会话
3. 发送 prompt
4. 等待当前轮输出
5. 如需查看项目文档或源码文件，可先用 `/ls` 或 `/find -q <keyword>` 定位，再通过 `/read -f <number>` 下载附件。

## 当前主流程

1. 在 Telegram 里发送 `/help`
2. 发送 `/projects`
3. 发送 `/create -n MyTask -w F:\project\YourProject`
4. 发送 `/send -n session-0001 -m "请先扫描项目并总结目录结构"`
5. 如需查看项目文档或源码文件，可先用 `/ls` 或 `/find -q <keyword>` 定位，再通过 `/read -f <number>` 下载附件。
6. 之后可以直接发送普通文本继续对话；如果想切到另一个项目，先执行 `/activate`。

## 当前能力

- `/help`：按当前运行配置输出实际可用命令、默认行为与关键参数
- `/projects`：列出允许根目录下的首层项目目录
- `/create`：创建新的逻辑 Codex 会话
- `/list`：同时展示托管会话和本机 Codex 历史对话，并生成编号
- `/activate`：支持 `sessionId`、`/list` 编号或本机 `codexConversationId`；必要时可加 `-w <workspace>` 直接激活历史对话
- `/send`：支持 `sessionId`、`/list` 编号或本机 `codexConversationId`，并自动等待当前轮结果
- 普通文本续聊：直接发给当前活动会话
- `/screen`：查看当前输出或按 cursor 查看增量输出
- `/ls`：浏览当前会话工作目录，并通过 `/ls -p <number>` 进入子目录
- `/find`：按名称搜索文件或目录，搜索结果编号可继续用于 `/ls` 或 `/read`
- `/read`：把工作区文件作为附件返回，支持相对路径或最近浏览结果编号
- 历史对话可直接通过 `/activate` 或 `/send` 接管
- `/enablePermission`：把会话切到 auto 模式；当前默认会映射到 `dangerous`，适合处理远程开发中的审批或 sandbox 阻塞
- `/disablePermission`：把会话切回 manual 执行档，恢复默认执行策略
- `/kill`：终止指定会话
- `/sys`：查看宿主机摘要
- 会话、任务、来源绑定持久化与重启恢复
- `safe`、`full-auto`、`dangerous` 三档执行策略
- Windows 为当前主要验证平台

## 快速开始

1. 安装依赖：`npm install`
2. 打开 `.env.example` 并填写你自己的 key
3. 运行时会优先读取 `.env`，如果 `.env` 不存在就自动回退到 `.env.example`
4. 至少配置以下参数：
   - `TG_BOT_TOKEN`
   - `TG_ALLOWED_CHAT_IDS`
   - `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
5. 确认本机可以在命令行直接执行 `codex`
6. 启动运行时：`npm run tg:bot`
7. 在 Telegram 中发送 `/help`

## 常用命令

- `/help`
- `/projects`
- `/create -n MyTask -w F:\project\YourProject`
- `/list`
- `/activate -n 1` 或 `/activate -n thread-123 -w F:\project\YourProject`
- `/send -n session-0001 -m "请先扫描项目并总结目录结构"`
- `/screen -n session-0001`
- `/ls`
- `/find -q requirements`
- `/read -f 1`
- `/read -n session-0001 -f README.md`
- `/send -n thread-123 -m "继续上次开发"`
- `/enablePermission -n session-0001`
- `/disablePermission -n session-0001`
- `/kill -n session-0001`
- `/sys`

## 常用脚本

- 最新自动化验证：`npm test` => `95/95`
- `npm run tg:bot`
- `npm run repl`
- `npm run service`
- `npm run wecom:server`

## 关键配置

完整参数见 `.env.example`。如果你更希望把个人配置和仓库模板分开，也可以手动复制一份为 `.env`；程序会优先使用 `.env`。

常用项：

- `TG_BOT_TOKEN`
- `TG_ALLOWED_CHAT_IDS`
- `TG_DEFAULT_CHAT_ID`
- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
- `CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE`
- `CODEX_PUPPETEER_CODEX_EXEC_PROFILE`
- `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE`：`auto` 模式对应的执行档；当前默认是 `dangerous`，如需更保守可改回 `full-auto`
- `CODEX_PUPPETEER_CODEX_SANDBOX`
- `CODEX_PUPPETEER_STORAGE_DIR`
- `CODEX_PUPPETEER_LOG_DIR`
- `CODEX_PUPPETEER_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_SYSTEM_MODE`

## 当前验证状态

- 主远程控制链路可用
- 最新自动化验证：`npm test` => `95/95`
- Windows 为当前主要验证平台
- 高风险系统动作默认保持 `dry-run`

## 说明

- `/wait` 已退役，不再是推荐用户命令；当前主流程是 `/send` + `/screen`
- 如果任务被本地审批或 sandbox 限制阻塞，可先执行 `/enablePermission`；处理完后再用 `/disablePermission` 恢复默认策略
- WeCom 入口仍保留在代码中，但个人使用主路径已经切到 Telegram
- 开源仓库默认公开 `README.md`、源码、测试、配置模板和必要的代理规范文件；`docs/` 与 `.agent/` 作为本地私有工作资料保留在你的机器上，不再建议公开
