## 2026-03-24 current project status

- Core baseline is stable: Telegram is the primary personal remote channel, Codex CLI is the execution core, and Windows is the current delivery platform.
- `/send` now auto-waits for the current reply, emits an immediate `screen: /screen -n ... -c ...` hint as a separate notification, and keeps the final completion message focused on assistant output or partial-output status.
- Runtime defaults are tuned for real use: buffered output is `500` lines, explicit wait timeout remains `120000ms`, and the dedicated `/send` wait timeout is `3600000ms` (1 hour).
- `/list` unifies managed sessions with local Codex history from `~/.codex/session_index.jsonl`, supports numbered selection, and works with `/activate` for active-session switching.
- `/send -n` accepts a managed `session-000x`, a visible list number, or a local Codex conversation id; when needed it auto-creates a managed session in the selected workspace context.
- Runtime persistence is enabled for sessions, tasks, and source bindings, and startup recovery interrupts unfinished tasks while cleaning up or marking residual active sessions.
- Latest automated verification is `npm test` => `81/81`.

## Remaining delivery gaps

- Assistant completion detection still depends on output-semantic heuristics and may need more tuning for complex real sessions.
- Long-running Windows service hardening is still in progress.
- Real shutdown orchestration exists in code but remains intentionally de-prioritized versus the remote-control path.
- macOS has not yet been validated to the same depth as Windows.

## Recommended next steps

1. Run one real Telegram `/send` against a long coding task and confirm the first reply waits through the answer within the new one-hour default window.
2. If a host needs a different wait profile, tune `.env` with `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS` and restart the bot runtime.
3. If any coding task still comes back partial, capture the immediate screen hint plus the later `/screen` output to decide whether the issue is timeout-related or a true completion-detection edge case.
