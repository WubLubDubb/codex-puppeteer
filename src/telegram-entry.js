import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDefaultAgent } from "./automation-agent.js";
import { loadRuntimeEnvironment } from "./config-loader.js";
import { defaultConfig } from "./default-config.js";
import { serializeError } from "./errors.js";
import { FanOutNotifier, InMemoryNotifier } from "./notifier.js";
import { recoverRuntimeState } from "./runtime-recovery.js";
import { FileSessionRepository } from "./session-repository.js";
import { FileSourceBindingRepository } from "./source-binding-repository.js";
import { resolveWorkspacePath } from "./storage-utils.js";
import { createSystemAdapter } from "./system-adapter.js";
import { FileTaskRepository } from "./task-repository.js";
import { TelegramBotClient } from "./telegram-client.js";
import { TelegramUpdateController } from "./telegram-controller.js";
import { TelegramBotNotifier } from "./telegram-notifier.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name, fallback = "") {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Environment variable ${name} is required.`);
  }
  return value;
}

function parseList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [...fallback];
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : [...fallback];
}

function resolvePositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveTransport(value, fallback = "auto") {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return ["auto", "fetch", "powershell"].includes(normalized) ? normalized : fallback;
}

export function createTelegramRuntimeConfigFromEnv({
  env = process.env,
  cwd = process.cwd(),
  baseConfig = defaultConfig
} = {}) {
  const allowedChatIds = parseList(
    env.TG_ALLOWED_CHAT_IDS,
    baseConfig.telegram.allowedChatIds ?? []
  );
  const allowedProjectRoots = parseList(
    env.CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS,
    baseConfig.security.allowedProjectRoots
  );
  const storageDir = resolveWorkspacePath(
    env.CODEX_PUPPETEER_STORAGE_DIR ?? baseConfig.runtime.storageDir,
    cwd
  );

  return {
    ...baseConfig,
    security: {
      ...baseConfig.security,
      allowedSources: allowedChatIds,
      allowedProjectRoots
    },
    runtime: {
      ...baseConfig.runtime,
      storageDir,
      defaultWaitTimeoutMs: resolvePositiveInteger(
        env.CODEX_PUPPETEER_WAIT_TIMEOUT_MS,
        baseConfig.runtime.defaultWaitTimeoutMs || 120000
      ),
      defaultSendWaitTimeoutMs: resolvePositiveInteger(
        env.CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS,
        baseConfig.runtime.defaultSendWaitTimeoutMs ??
          baseConfig.runtime.defaultWaitTimeoutMs ??
          120000
      ),
      sessionsFilePath: resolveWorkspacePath(
        env.CODEX_PUPPETEER_SESSIONS_FILE ?? path.join(storageDir, "sessions.json"),
        cwd
      ),
      tasksFilePath: resolveWorkspacePath(
        env.CODEX_PUPPETEER_TASKS_FILE ?? path.join(storageDir, "tasks.json"),
        cwd
      ),
      sourceBindingsFilePath: resolveWorkspacePath(
        env.CODEX_PUPPETEER_SOURCE_BINDINGS_FILE ?? path.join(storageDir, "source-bindings.json"),
        cwd
      )
    },
    system: {
      ...baseConfig.system,
      actionMode:
        (env.CODEX_PUPPETEER_SYSTEM_MODE || baseConfig.system.actionMode || "dry-run")
          .trim()
          .toLowerCase() === "real"
          ? "real"
          : "dry-run"
    },
    telegram: {
      ...baseConfig.telegram,
      botToken: env.TG_BOT_TOKEN || baseConfig.telegram.botToken,
      apiBaseUrl: env.TG_API_BASE_URL || baseConfig.telegram.apiBaseUrl,
      defaultRecipient: env.TG_DEFAULT_CHAT_ID || baseConfig.telegram.defaultRecipient,
      allowedChatIds,
      pollIntervalMs: resolvePositiveInteger(
        env.TG_POLL_INTERVAL_MS,
        baseConfig.telegram.pollIntervalMs || 1000
      ),
      longPollTimeoutSec: resolvePositiveInteger(
        env.TG_LONG_POLL_TIMEOUT_SEC,
        baseConfig.telegram.longPollTimeoutSec || 20
      ),
      commandDispatchMode:
        env.TG_COMMAND_DISPATCH_MODE || baseConfig.telegram.commandDispatchMode,
      maxMessageLength: resolvePositiveInteger(
        env.TG_MAX_MESSAGE_LENGTH,
        baseConfig.telegram.maxMessageLength || 3500
      ),
      transport: resolveTransport(env.TG_TRANSPORT, baseConfig.telegram.transport || "auto")
    },
    service: {
      ...baseConfig.service,
      envFiles: parseList(env.CODEX_PUPPETEER_ENV_FILES, baseConfig.service.envFiles ?? [".env"])
    }
  };
}

export function createTelegramNotifierBundle(config, { client } = {}) {
  const memoryNotifier = new InMemoryNotifier();
  const { botToken, apiBaseUrl, defaultRecipient, maxMessageLength, transport } = config.telegram;

  if (!botToken) {
    return {
      notifier: memoryNotifier,
      activeNotificationEnabled: false,
      client: null
    };
  }

  const resolvedClient = client ?? new TelegramBotClient({
    botToken,
    apiBaseUrl,
    transport
  });
  const telegramNotifier = new TelegramBotNotifier({
    client: resolvedClient,
    defaultRecipient,
    maxMessageLength
  });

  return {
    notifier: new FanOutNotifier([memoryNotifier, telegramNotifier]),
    activeNotificationEnabled: true,
    client: resolvedClient
  };
}

export async function startTelegramPollingRuntime({
  env = process.env,
  cwd = process.cwd(),
  baseConfig = defaultConfig,
  notifier,
  agent,
  repository,
  sessionRepository,
  sourceBindingRepository,
  codexAdapter,
  systemAdapter,
  client,
  logger = console,
  startLoop = true
} = {}) {
  const preConfig = createTelegramRuntimeConfigFromEnv({ env, cwd, baseConfig });
  const envLoad = loadRuntimeEnvironment({
    env,
    cwd,
    envFileNames: preConfig.service.envFiles
  });
  const config = createTelegramRuntimeConfigFromEnv({ env, cwd, baseConfig });
  const botToken = requireEnv("TG_BOT_TOKEN", config.telegram.botToken);
  const notifierBundle = notifier
    ? {
        notifier,
        activeNotificationEnabled: true,
        client: client ?? new TelegramBotClient({
          botToken,
          apiBaseUrl: config.telegram.apiBaseUrl,
          transport: config.telegram.transport
        })
      }
    : createTelegramNotifierBundle(config, {
        client: client ?? new TelegramBotClient({
          botToken,
          apiBaseUrl: config.telegram.apiBaseUrl,
          transport: config.telegram.transport
        })
      });

  const resolvedRepository =
    repository ??
    (agent
      ? null
      : new FileTaskRepository({
          storageFilePath: config.runtime.tasksFilePath
        }));
  const resolvedSessionRepository =
    sessionRepository ??
    (agent
      ? null
      : new FileSessionRepository({
          storageFilePath: config.runtime.sessionsFilePath,
          maxBufferedLines: config.runtime.maxBufferedLines
        }));
  const resolvedSourceBindingRepository =
    sourceBindingRepository ??
    (agent
      ? null
      : new FileSourceBindingRepository({
          storageFilePath: config.runtime.sourceBindingsFilePath
        }));
  const resolvedSystemAdapter =
    systemAdapter ??
    (agent
      ? null
      : createSystemAdapter({
          mode: config.system.actionMode,
          platform: process.platform
        }));
  const resolvedAgent =
    agent ??
    createDefaultAgent({
      config,
      repository: resolvedRepository ?? undefined,
      sessionRepository: resolvedSessionRepository ?? undefined,
      sourceBindingRepository: resolvedSourceBindingRepository ?? undefined,
      notifier: notifierBundle.notifier,
      codexAdapter,
      systemAdapter: resolvedSystemAdapter ?? undefined
    });
  const recovery =
    agent || !resolvedSessionRepository || !resolvedRepository
      ? null
      : await recoverRuntimeState({
          sessionRepository: resolvedSessionRepository,
          taskRepository: resolvedRepository,
          notifier: notifierBundle.notifier,
          logger,
          platform: process.platform
        });
  const controller = new TelegramUpdateController({
    agent: resolvedAgent,
    notifier: notifierBundle.notifier,
    commandDispatchMode: config.telegram.commandDispatchMode,
    logger
  });

  let running = true;
  let offset = 0;

  const loopPromise = startLoop
    ? (async () => {
        while (running) {
          try {
            const updates = await notifierBundle.client.getUpdates({
              offset,
              timeout: config.telegram.longPollTimeoutSec
            });

            for (const update of updates) {
              if (typeof update?.update_id === "number") {
                offset = update.update_id + 1;
              }
              await controller.handleUpdate(update);
            }

            if (updates.length === 0 && config.telegram.pollIntervalMs > 0) {
              await delay(config.telegram.pollIntervalMs);
            }
          } catch (error) {
            logger?.error?.("Telegram polling failed", serializeError(error));
            if (config.telegram.pollIntervalMs > 0) {
              await delay(config.telegram.pollIntervalMs);
            }
          }
        }
      })()
    : Promise.resolve();

  return {
    config,
    envLoad,
    notifier: notifierBundle.notifier,
    agent: resolvedAgent,
    repository: resolvedRepository,
    sessionRepository: resolvedSessionRepository,
    sourceBindingRepository: resolvedSourceBindingRepository,
    systemAdapter: resolvedSystemAdapter,
    recovery,
    client: notifierBundle.client,
    controller,
    capabilities: {
      activeNotificationEnabled: notifierBundle.activeNotificationEnabled
    },
    stop() {
      running = false;
    },
    loopPromise
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await startTelegramPollingRuntime();
  console.log("Telegram polling bot started.");
  console.log(`Allowed chat ids: ${runtime.config.security.allowedSources.join(", ") || "(none)"}`);
  console.log(`Allowed project roots: ${runtime.config.security.allowedProjectRoots.join(", ")}`);
  console.log(`Sessions file: ${runtime.config.runtime.sessionsFilePath}`);
  console.log(`Tasks file: ${runtime.config.runtime.tasksFilePath}`);
  console.log(`Source bindings file: ${runtime.config.runtime.sourceBindingsFilePath}`);
}
