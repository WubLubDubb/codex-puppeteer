# codex-puppeteer

## Overview

codex-puppeteer is a personal remote-control agent for Codex CLI.
The current primary workflow is:

- receive commands from Telegram Bot
- run Codex CLI inside a selected project directory
- keep logical sessions with persistence
- continue existing conversations, inspect output, and read project files

This project is not a VS Code GUI automation tool.
The primary execution target is Codex CLI.

## Current capabilities

- Telegram as the main remote entry
- /send waits for the current reply automatically and sends a separate screen hint immediately
- /screen inspects buffered and incremental output
- /projects lists first-level project folders under allowed roots
- /attach and /attach-last resume existing Codex conversations
- persisted sessions, tasks, and source bindings
- Windows-first validation

## Quick start

1. Install dependencies: `npm install`
2. Fill `.env` from `.env.example`
3. Set at least these values:
   - `TG_BOT_TOKEN`
   - `TG_ALLOWED_CHAT_IDS`
   - `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
4. Start the Telegram bot runtime: `npm run tg:bot`
5. Send commands from Telegram

## Common commands

- `/projects`
- `/projects -w F:\project`
- `/create -n DemoProject -w F:\project\demo`
- `/attach -last -w F:\project\demo -n DemoProject`
- `/attach -i <codex_session_id> -w F:\project\demo -n DemoProject`
- `/send -n session-0001 -m "Scan this project and summarize the structure"`
- `/screen -n session-0001`
- `/activate -n session-0002`
- `/read -n session-0001 -f README.md`
- `/list`
- `/kill -n session-0001`
- `/sys`

## Scripts

- `npm test`
- `npm run tg:bot`
- `npm run repl`
- `npm run service`
- `npm run wecom:server`

## Key configuration

See `.env.example` for the full list.
Common values:

- `TG_BOT_TOKEN`
- `TG_ALLOWED_CHAT_IDS`
- `TG_DEFAULT_CHAT_ID`
- `CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS`
- `CODEX_PUPPETEER_STORAGE_DIR`
- `CODEX_PUPPETEER_LOG_DIR`
- `CODEX_PUPPETEER_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS`
- `CODEX_PUPPETEER_SYSTEM_MODE`

## Validation status

- main remote-control workflow is available
- latest automated verification: `npm test` => `81/81`
- Windows is the current primary validation platform
- high-risk system actions remain dry-run by default

## Notes

- WeCom support still exists in code, but Telegram is the main personal-use path now.
- If VS Code opened a file with the wrong encoding before, reopen the file with UTF-8 after refresh.
