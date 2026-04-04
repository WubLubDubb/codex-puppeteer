# codex-puppeteer

`codex-puppeteer` 是一个通过 Telegram 远程控制本机 `Codex CLI` 的轻量代理。

它适合个人开发场景：你平时仍然在电脑上正常使用 `codex`，但当你离开电脑时，可以通过 Telegram 在手机上继续管理项目、切换会话、续接历史对话、查看输出、浏览目录、下载文档文件。

## 功能概览

- 创建新的 Codex 会话
- 接管本机已有的 Codex 历史对话
- 远程发送 prompt，并自动等待当前轮回复
- 查看会话当前输出或增量输出
- 浏览项目目录、进入子目录、返回上一级
- 搜索文件和目录
- 将文件作为 Telegram 附件直接返回
- 持久化保存会话、任务和聊天绑定关系
- 重启后恢复本地运行状态

## 系统要求

- Node.js 18+
- 本机已安装并可直接执行 `codex`
- Windows、macOS 或 Linux
- 一个 Telegram Bot Token

建议先在终端确认：

```bash
codex --version
```

## 安装

```bash
npm install
```

## 配置

仓库提供了 [`.env.example`](.env.example) 作为模板。

运行时会优先读取 `.env`；如果 `.env` 不存在，则回退到 `.env.example`。正式使用建议复制出一份 `.env`，只修改其中的值即可。

### 最小配置

```env
TG_BOT_TOKEN=你的TelegramBotToken
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

```env
CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE=manual
CODEX_PUPPETEER_CODEX_EXEC_PROFILE=safe
CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE=dangerous
```

含义：

- `manual + safe`：默认保留更稳妥的执行策略
- `auto + dangerous`：执行 `/enablePermission` 后，切到更激进的远程执行模式，适合完全受信任的个人主机

## 运行

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

同时，程序会自动向 Telegram 注册一组常用命令菜单，手机端输入 `/` 时可以直接点选。

## 推荐使用流程

第一次进入一个聊天时：

```text
/help
/projects
/create MyTask 1
/send 请先扫描项目并总结目录结构
/current
```

后续继续当前会话时：

```text
继续开发登录模块
```

如果是长任务，想追踪过程：

```text
/screen
```

如果想切换到别的会话：

```text
/list
/activate 3
继续上次的开发
```

## 命令说明

### 会话管理

- `/help`
  查看帮助和当前运行配置摘要。
- `/projects`
  列出允许根目录下的项目文件夹，结果带编号。
- `/create -n <名称> -w <项目路径>`
  创建新的托管会话。
- `/create <名称> <项目编号>`
  通过 `/projects` 返回的编号快速创建会话。
- `/list`
  查看当前托管会话和本机可接管的 Codex 历史对话。
- `/activate -n <编号|sessionId|codexId> [-w <项目路径>]`
  将某个会话切换为当前聊天的活动会话。
- `/current`
  查看当前聊天绑定的活动会话、项目路径、浏览目录和权限状态。
- `/kill -n <sessionId>`
  终止一个托管会话。

### 对话交互

- `/send -n <目标> -m <内容>`
  向指定会话或历史对话发送消息。
- `/send <内容>`
  向当前已激活会话发送消息。
- 直接发送普通文本
  如果当前聊天已经绑定活动会话，可直接续聊，不必每次都写 `/send`。
- `/screen`
  查看当前活动会话最近输出。
- `/screen -n <目标> -c <cursor>`
  查看指定会话某个游标之后的增量输出。

说明：

- `/send` 会自动等待当前轮输出，不需要再显式调用 `/wait`
- `/send` 开始后会先单独返回一条推荐的 `/screen` 指令，方便你马上追踪长任务

### 文件浏览

- `/ls`
  查看当前浏览目录内容。
- `/ls -p <编号>`
  进入某个子目录。
- `/ls -p ..`
  返回上一级目录。
- `/ls -p /`
  回到项目根目录。
- `/find -q <关键词>`
  搜索文件或目录。
- `/read -f <相对路径>`
  下载指定文件。
- `/read -f <编号>`
  下载最近一次 `/ls` 或 `/find` 结果中的编号文件。

### 权限与系统

- `/enablePermission -n <sessionId>`
  将会话切换到自动权限模式。
- `/disablePermission -n <sessionId>`
  恢复默认权限模式。
- `/sys`
  查看宿主机和代理摘要。

## 短别名

- `/h` = `/help`
- `/p` = `/projects`
- `/c` = `/create`
- `/l` = `/list`
- `/a` = `/activate`
- `/s` = `/send`
- `/sc` = `/screen`
- `/r` = `/read`
- `/cur` = `/current`
- `/ctx` = `/current`
- `/k` = `/kill`
- `/ep` = `/enablePermission`
- `/dp` = `/disablePermission`

示例：

```text
/c DemoTask 1
/a 3
/s 3 继续开发
/s 继续开发
```

## 历史对话续接

`/list` 会同时显示：

- 当前托管会话
- 本机 Codex 可恢复的历史会话

你可以直接按编号续接，例如：

```text
/list
/activate 4
继续上次的开发
```

也可以不先激活，直接发送：

```text
/send -n 4 -m 继续上次的开发
```

## 运行数据

默认会在本地生成：

- `.agent/runtime/`

其中通常包含：

- `sessions.json`
- `tasks.json`
- `source-bindings.json`

这些文件用于恢复会话、任务状态和聊天绑定关系，正式使用时建议保留。

## 常用脚本

```bash
npm run tg:bot
npm run repl
npm run test
```

说明：

- `tg:bot`：启动 Telegram 轮询机器人
- `repl`：本地调试入口
- `test`：运行测试

## 部署建议

Windows：

1. 把项目放到稳定目录
2. 使用 `.env` 保存正式配置
3. 先手动运行 `npm run tg:bot` 验证
4. 稳定后再接入 NSSM、计划任务或其他守护方式常驻运行

macOS / Linux：

1. 使用 `.env` 保存正式配置
2. 先手动运行 `npm run tg:bot`
3. 再接入 `pm2`、`systemd`、`launchd` 或其他守护工具

## 常见问题

### 1. 机器人启动后没有响应

优先检查：

- `TG_BOT_TOKEN` 是否正确
- `TG_ALLOWED_CHAT_IDS` 是否包含当前聊天 ID
- 本机是否能正常访问 Telegram API
- 终端里是否有轮询报错

### 2. 发送命令后 Codex 无法启动

请检查：

- 本机命令行是否可以直接执行 `codex`
- 项目路径是否在 `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS` 允许范围内
- 当前用户是否有对应目录的访问权限

### 3. 为什么重启后还能看到之前的会话

因为程序会把会话、任务和聊天绑定关系保存在 `.agent/runtime/` 中，用于恢复运行状态。

### 4. 为什么 `/read` 返回的是附件

这是为了更适合在手机端查看 Markdown、配置文件和文档，避免长文本直接塞满聊天窗口。

## 安全说明

本项目具备远程执行和会话控制能力，部署时请务必注意：

- 不要泄露 Telegram Bot Token
- 不要把允许访问的项目根目录配置得过大
- 不要在不受信任的主机上使用激进执行档
- 在确认风险前，保持 `CODEX_PUPPETEER_SYSTEM_MODE=dry-run`

## License

本项目采用 MIT License。详见 [LICENSE](LICENSE)。
