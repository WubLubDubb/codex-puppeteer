# 项目阶段状态

## 当前阶段

- 项目阶段：`MVP 可交付`
- 当前主线：`Telegram -> Automation Agent -> Codex CLI -> Telegram`
- 当前主平台：`Windows`
- 当前主交互：`/help`、`/projects`、`/create`、`/list`、`/activate`、`/send`、`/screen`

## 已完成能力

- Telegram 远程消息接入、来源校验与消息回传
- 基于允许根目录创建逻辑会话
- 本机 Codex 历史对话接入与续聊
- `/send` 自动等待当前轮结果，并立即给出 `/screen` 提示
- `/list` 聚合托管会话与本机历史会话，并支持编号选择
- `/activate` 切换当前聊天绑定的活动会话
- `/help` 按运行配置生成实际帮助文本
- 会话、任务、来源绑定持久化与重启恢复
- 执行档位切换与可选 sandbox 覆盖

## 仍在推进

- assistant 完成态识别的复杂场景调优
- Windows 常驻服务部署、日志落盘、异常告警
- 更完整的生产运行说明

## 暂不作为主验收内容

- VS Code GUI 自动化
- macOS 深度验证
- 真实关机联动
