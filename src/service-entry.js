import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDefaultAgent } from "./automation-agent.js";
import { loadRuntimeEnvironment } from "./config-loader.js";
import { defaultConfig } from "./default-config.js";
import { serializeError } from "./errors.js";
import { FileLogger } from "./file-logger.js";
import { FileSessionRepository } from "./session-repository.js";
import { FileSourceBindingRepository } from "./source-binding-repository.js";
import { recoverRuntimeState } from "./runtime-recovery.js";
import { resolveWorkspacePath } from "./storage-utils.js";
import { createSystemAdapter } from "./system-adapter.js";
import { FileTaskRepository } from "./task-repository.js";
import {
  createRuntimeConfigFromEnv,
  createWeComNotifierBundle,
  startWeComRuntime
} from "./wecom-entry.js";

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseList(value, fallback = []) {
  if (typeof value !== "string") {
    return [...fallback];
  }

  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items : [...fallback];
}

export function createServiceRuntimeConfigFromEnv({
  env = process.env,
  cwd = process.cwd(),
  baseConfig = defaultConfig
} = {}) {
  const runtimeConfig = createRuntimeConfigFromEnv({ env, baseConfig });
  const storageDir = resolveWorkspacePath(
    env.CODEX_PUPPETEER_STORAGE_DIR ?? runtimeConfig.runtime.storageDir,
    cwd
  );
  const logDir = resolveWorkspacePath(
    env.CODEX_PUPPETEER_LOG_DIR ?? runtimeConfig.service.logDir,
    cwd
  );
  const serviceName = env.CODEX_PUPPETEER_SERVICE_NAME || runtimeConfig.service.serviceName;

  return {
    ...runtimeConfig,
    runtime: {
      ...runtimeConfig.runtime,
      storageDir,
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
      ...runtimeConfig.system,
      actionMode:
        (env.CODEX_PUPPETEER_SYSTEM_MODE || runtimeConfig.system.actionMode || "dry-run")
          .trim()
          .toLowerCase() === "real"
          ? "real"
          : "dry-run"
    },
    service: {
      ...runtimeConfig.service,
      serviceName,
      logDir,
      envFiles: parseList(
        env.CODEX_PUPPETEER_ENV_FILES,
        runtimeConfig.service.envFiles ?? [".env"]
      ),
      notifyOnFatal: parseBoolean(
        env.CODEX_PUPPETEER_NOTIFY_ON_FATAL,
        runtimeConfig.service.notifyOnFatal
      )
    }
  };
}

function installRuntimeHandlers({ logger, notifier, config, server }) {
  const disposers = [];

  const notifyFatal = async (phase, error) => {
    const serialized = serializeError(error);
    logger.error(`Runtime ${phase}`, serialized);

    if (!config.service.notifyOnFatal) {
      return;
    }

    await notifier?.send?.({
      taskId: null,
      phase,
      sourceId: "system",
      message: `Service ${phase}: ${serialized.message}`
    });
  };

  const closeServer = () => new Promise((resolve) => {
    if (!server || typeof server.close !== "function") {
      resolve();
      return;
    }

    server.close(() => resolve());
  });

  const uncaughtExceptionHandler = (error) => {
    void notifyFatal("runtime.uncaught_exception", error).finally(() => {
      setTimeout(() => process.exit(1), 250);
    });
  };

  const unhandledRejectionHandler = (error) => {
    void notifyFatal("runtime.unhandled_rejection", error);
  };

  const shutdownHandler = (signal) => {
    logger.info(`Received ${signal}, shutting down service.`);
    void closeServer().finally(() => process.exit(0));
  };

  process.on("uncaughtException", uncaughtExceptionHandler);
  disposers.push(() => process.off("uncaughtException", uncaughtExceptionHandler));

  process.on("unhandledRejection", unhandledRejectionHandler);
  disposers.push(() => process.off("unhandledRejection", unhandledRejectionHandler));

  process.on("SIGINT", shutdownHandler);
  disposers.push(() => process.off("SIGINT", shutdownHandler));

  process.on("SIGTERM", shutdownHandler);
  disposers.push(() => process.off("SIGTERM", shutdownHandler));

  return () => {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}

export async function startManagedWeComService({
  env = process.env,
  cwd = process.cwd(),
  baseConfig = defaultConfig
} = {}) {
  const preConfig = createServiceRuntimeConfigFromEnv({ env, cwd, baseConfig });
  const envLoad = loadRuntimeEnvironment({
    env,
    cwd,
    envFileNames: preConfig.service.envFiles
  });
  const config = createServiceRuntimeConfigFromEnv({ env, cwd, baseConfig });
  const logger = new FileLogger({
    logDir: config.service.logDir,
    serviceName: config.service.serviceName
  });
  const notifierBundle = createWeComNotifierBundle(config);
  const repository = new FileTaskRepository({
    storageFilePath: config.runtime.tasksFilePath
  });
  const sessionRepository = new FileSessionRepository({
    storageFilePath: config.runtime.sessionsFilePath,
    maxBufferedLines: config.runtime.maxBufferedLines
  });
  const sourceBindingRepository = new FileSourceBindingRepository({
    storageFilePath: config.runtime.sourceBindingsFilePath
  });
  const systemAdapter = createSystemAdapter({
    mode: config.system.actionMode,
    platform: process.platform
  });
  const agent = createDefaultAgent({
    config,
    repository,
    sessionRepository,
    sourceBindingRepository,
    notifier: notifierBundle.notifier,
    systemAdapter
  });
  const recovery = await recoverRuntimeState({
    sessionRepository,
    taskRepository: repository,
    notifier: notifierBundle.notifier,
    logger,
    platform: process.platform
  });
  const runtime = await startWeComRuntime({
    config,
    notifier: notifierBundle.notifier,
    agent,
    logger,
    capabilities: {
      activeNotificationEnabled: notifierBundle.activeNotificationEnabled
    }
  });
  const disposeHandlers = installRuntimeHandlers({
    logger,
    notifier: notifierBundle.notifier,
    config,
    server: runtime.server
  });

  logger.info("Managed WeCom service started.", {
    port: runtime.port,
    callbackPath: runtime.callbackPath,
    systemMode: config.system.actionMode,
    sessionsFilePath: config.runtime.sessionsFilePath,
    tasksFilePath: config.runtime.tasksFilePath,
    activeNotificationEnabled: runtime.capabilities.activeNotificationEnabled
  });

  return {
    ...runtime,
    logger,
    recovery,
    envLoad,
    repository,
    sessionRepository,
    systemAdapter,
    disposeHandlers
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await startManagedWeComService();
  console.log(
    `Managed WeCom service listening on http://0.0.0.0:${runtime.port}${runtime.callbackPath}`
  );
  console.log(`System mode: ${runtime.config.system.actionMode}`);
  console.log(`Sessions file: ${runtime.config.runtime.sessionsFilePath}`);
  console.log(`Tasks file: ${runtime.config.runtime.tasksFilePath}`);
  console.log(`Log dir: ${runtime.config.service.logDir}`);
}

