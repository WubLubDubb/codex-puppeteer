## 2026-03-26 current project status

- Core baseline is stable: Telegram is the primary personal remote channel, Codex CLI is the execution core, and Windows is the current delivery platform.
- `/help` is now available and runtime-aware. It shows the real command set, allowed project roots, wait defaults, permission mode, execution profiles, sandbox mode, and system mode.
- `/send` auto-waits for the current reply, emits an immediate `screen: /screen -n ... -c ...` hint as a separate notification, and keeps the final completion message focused on assistant output or partial-output status.
- Runtime defaults are tuned for real use: buffered output is `500` lines, explicit wait timeout remains `120000ms`, and the dedicated `/send` wait timeout is `3600000ms`.
- `/list` unifies managed sessions with local Codex history from `~/.codex/session_index.jsonl`, supports numbered selection, and `/activate` can now switch both managed sessions and local history conversations.
- `/ls` and `/find` now provide lightweight per-chat, per-session browse state, so mobile users can walk project folders by number instead of remembering relative paths.
- `/read` now returns attachment metadata and Telegram delivers the resolved project file as a document attachment rather than inline text; it also accepts the latest browse-result number or a path relative to the current browse folder.
- `/send -n` accepts a managed `session-000x`, a visible list number, or a local Codex conversation id; when needed it auto-creates a managed session in the selected workspace context.
- Exec permission strategy is configurable: `safe`, `full-auto`, and `dangerous` profiles are available, with an optional sandbox override; the current default mapping is `manual -> safe` and `auto -> dangerous`, `/enablePermission` switches a session to auto mode, and `/disablePermission` restores the default manual mode.
- Runtime persistence is enabled for sessions, tasks, and source bindings, and startup recovery interrupts unfinished tasks while cleaning up or marking residual active sessions.
- Latest automated verification is `npm test` => `92/92`.
- Active docs were re-reviewed on 2026-03-26; `docs/requirements.md` is now at `v1.4.4`, and the active doc set remains aligned to the current Telegram + Codex CLI baseline.

## Remaining delivery gaps

- Assistant completion detection still depends on output-semantic heuristics and may need more tuning for complex real sessions.
- Long-running Windows service hardening is still in progress.
- True interactive `/approve` or `/deny` handling is still not implemented; the current production path is configurable exec profiles rather than remote button-click approval.
- Real shutdown orchestration exists in code but remains intentionally de-prioritized versus the remote-control path.
- macOS has not yet been validated to the same depth as Windows.

## Recommended next steps

1. Run one real Telegram `/send` against a long coding task and confirm the first reply waits through the answer within the one-hour default window.
2. The current default already makes `/enablePermission` switch remote runs to `auto -> dangerous`; if a host needs a safer fallback, tune `.env` with `CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE`, `CODEX_PUPPETEER_CODEX_EXEC_PROFILE`, `CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE=full-auto`, and `CODEX_PUPPETEER_CODEX_SANDBOX`, then restart the bot runtime.
3. If any coding task still comes back partial, capture the immediate screen hint plus the later `/screen` output to decide whether the issue is timeout-related or a true completion-detection edge case.



