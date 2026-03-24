import { pathToFileURL } from "node:url";
import { createDefaultAgent } from "./automation-agent.js";
import { defaultConfig } from "./default-config.js";
import { FanOutNotifier, InMemoryNotifier } from "./notifier.js";
import { WeComAccessTokenProvider, WeComClient } from "./wecom-client.js";
import { WeComCallbackController } from "./wecom-controller.js";
import { WeComCrypto } from "./wecom-crypto.js";
import { WeComAppNotifier } from "./wecom-notifier.js";
import { startWeComHttpServer } from "./wecom-server.js";

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

function resolvePort(value, fallback) {
  const port = Number(value ?? fallback);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function resolvePositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolvePermissionMode(value, fallback = "manual") {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return normalized === "auto" ? "auto" : "manual";
}

function resolveExecProfile(value, fallback = "safe") {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return ["safe", "full-auto", "dangerous"].includes(normalized) ? normalized : fallback;
}

function resolveSandboxMode(value, fallback = null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return ["read-only", "workspace-write", "danger-full-access"].includes(normalized)
    ? normalized
    : fallback;
}

export function createRuntimeConfigFromEnv({ env = process.env, baseConfig = defaultConfig } = {}) {
  const allowedSources = parseList(
    env.WECOM_ALLOWED_SOURCES ?? env.ALLOWED_SOURCES,
    baseConfig.wecom.allowedSources ?? baseConfig.security.allowedSources
  );
  const allowedProjectRoots = parseList(
    env.CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS,
    baseConfig.security.allowedProjectRoots
  );
  const corpId = env.WECOM_CORP_ID || baseConfig.wecom.corpId;
  const maxMessageLength = resolvePositiveInteger(
    env.WECOM_MAX_MESSAGE_LENGTH,
    baseConfig.wecom.maxMessageLength || 1200
  );

  return {
    ...baseConfig,
    security: {
      ...baseConfig.security,
      allowedSources,
      allowedProjectRoots
    },
    runtime: {
      ...baseConfig.runtime,
      defaultPermissionMode: resolvePermissionMode(
        env.CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE,
        baseConfig.runtime.defaultPermissionMode || "manual"
      ),
      defaultExecProfile: resolveExecProfile(
        env.CODEX_PUPPETEER_CODEX_EXEC_PROFILE,
        baseConfig.runtime.defaultExecProfile || "safe"
      ),
      autoPermissionExecProfile: resolveExecProfile(
        env.CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE,
        baseConfig.runtime.autoPermissionExecProfile || "full-auto"
      ),
      codexSandboxMode: resolveSandboxMode(
        env.CODEX_PUPPETEER_CODEX_SANDBOX,
        baseConfig.runtime.codexSandboxMode ?? null
      ),
      defaultWaitTimeoutMs: resolvePositiveInteger(
        env.CODEX_PUPPETEER_WAIT_TIMEOUT_MS,
        baseConfig.runtime.defaultWaitTimeoutMs || 120000
      ),
      defaultSendWaitTimeoutMs: resolvePositiveInteger(
        env.CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS,
        baseConfig.runtime.defaultSendWaitTimeoutMs ??
          baseConfig.runtime.defaultWaitTimeoutMs ??
          120000
      )
    },
    wecom: {
      ...baseConfig.wecom,
      callbackPath: env.WECOM_CALLBACK_PATH || baseConfig.wecom.callbackPath,
      port: resolvePort(env.WECOM_PORT, baseConfig.wecom.port || 8787),
      corpId,
      agentId: env.WECOM_AGENT_ID || baseConfig.wecom.agentId,
      corpSecret: env.WECOM_CORP_SECRET || baseConfig.wecom.corpSecret,
      token: env.WECOM_TOKEN || baseConfig.wecom.token,
      encodingAESKey: env.WECOM_ENCODING_AES_KEY || baseConfig.wecom.encodingAESKey,
      receiveId: env.WECOM_RECEIVE_ID || baseConfig.wecom.receiveId || corpId,
      passiveReplyMode: env.WECOM_PASSIVE_REPLY_MODE || baseConfig.wecom.passiveReplyMode,
      commandDispatchMode:
        env.WECOM_COMMAND_DISPATCH_MODE || baseConfig.wecom.commandDispatchMode,
      defaultRecipient: env.WECOM_DEFAULT_RECIPIENT || baseConfig.wecom.defaultRecipient,
      allowedSources,
      maxMessageLength
    }
  };
}

export function createWeComNotifierBundle(config) {
  const memoryNotifier = new InMemoryNotifier();
  const { corpId, corpSecret, agentId, defaultRecipient, maxMessageLength } = config.wecom;

  if (!corpId || !corpSecret || !agentId) {
    return {
      notifier: memoryNotifier,
      activeNotificationEnabled: false
    };
  }

  const tokenProvider = new WeComAccessTokenProvider({
    corpId,
    corpSecret
  });
  const client = new WeComClient({
    agentId,
    tokenProvider
  });
  const wecomNotifier = new WeComAppNotifier({
    client,
    defaultRecipient,
    maxMessageLength
  });

  return {
    notifier: new FanOutNotifier([memoryNotifier, wecomNotifier]),
    activeNotificationEnabled: true
  };
}

export async function startWeComRuntime({
  config = createRuntimeConfigFromEnv(),
  notifier,
  agent,
  logger = console,
  capabilities
} = {}) {
  const token = requireEnv("WECOM_TOKEN", config.wecom.token);
  const encodingAESKey = requireEnv(
    "WECOM_ENCODING_AES_KEY",
    config.wecom.encodingAESKey
  );
  const notifierBundle = notifier
    ? {
        notifier,
        activeNotificationEnabled: capabilities?.activeNotificationEnabled ?? false
      }
    : createWeComNotifierBundle(config);
  const resolvedAgent = agent ?? createDefaultAgent({ config, notifier: notifierBundle.notifier });
  const crypto = new WeComCrypto({
    token,
    encodingAESKey,
    receiveId: config.wecom.receiveId
  });
  const controller = new WeComCallbackController({
    agent: resolvedAgent,
    crypto,
    passiveReplyMode: config.wecom.passiveReplyMode,
    commandDispatchMode: config.wecom.commandDispatchMode,
    logger
  });
  const server = await startWeComHttpServer({
    controller,
    callbackPath: config.wecom.callbackPath,
    port: config.wecom.port
  });

  return {
    config,
    notifier: notifierBundle.notifier,
    agent: resolvedAgent,
    crypto,
    controller,
    server,
    callbackPath: config.wecom.callbackPath,
    port: config.wecom.port,
    capabilities: {
      activeNotificationEnabled: notifierBundle.activeNotificationEnabled
    }
  };
}

export async function startDefaultWeComRuntime(options = {}) {
  return startWeComRuntime(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await startDefaultWeComRuntime();
  console.log(
    `WeCom callback server listening on http://0.0.0.0:${runtime.port}${runtime.callbackPath}`
  );
  console.log(`WeCom passive reply mode: ${runtime.config.wecom.passiveReplyMode}`);
  console.log(`WeCom command dispatch mode: ${runtime.config.wecom.commandDispatchMode}`);
  console.log(
    `WeCom active notification: ${runtime.capabilities.activeNotificationEnabled ? "enabled" : "disabled"}`
  );
  console.log(`Allowed sources: ${runtime.config.security.allowedSources.join(", ")}`);
}
