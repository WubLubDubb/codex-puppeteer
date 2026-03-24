import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createTelegramRuntimeConfigFromEnv, startTelegramPollingRuntime } from "../src/telegram-entry.js";

function createTempDir(prefix) {
  const tempDir = path.join(
    process.cwd(),
    "tmp",
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ControlledExecTelegramAdapter {
  constructor() {
    this.threadSequence = 0;
    this.sentPrompts = [];
  }

  async createSession({ session }) {
    return {
      actionId: "create",
      summary: `Created controlled session ${session.sessionId}.`,
      driver: "exec-json",
      sessionStatus: "ready"
    };
  }

  async sendPrompt({ session, prompt, hooks = {} }) {
    const resumedThreadId = session.codexThreadId ?? null;
    const resolvedThreadId = resumedThreadId ?? `thread-${++this.threadSequence}`;

    this.sentPrompts.push({
      sessionId: session.sessionId,
      prompt,
      resumedThreadId
    });

    setTimeout(() => {
      hooks.onMetadata?.({
        driver: "exec-json",
        codexThreadId: resolvedThreadId
      });
      hooks.onOutput?.({
        sessionId: session.sessionId,
        stream: "stdout",
        content: `Controlled reply for ${prompt}`
      });
      hooks.onExit?.({
        exitCode: 0,
        signal: null,
        nextStatus: "ready",
        preserveBinding: true,
        metadata: {
          driver: "exec-json",
          codexThreadId: resolvedThreadId
        }
      });
    }, 10);

    return {
      actionId: "send",
      summary: `Prompt sent to controlled session ${session.sessionId}.`,
      pid: 4321,
      driver: "exec-json",
      sessionStatus: "running"
    };
  }

  async killSession({ session }) {
    return {
      actionId: "kill",
      summary: `Stopped controlled session ${session.sessionId}.`
    };
  }

  async enablePermission({ session }) {
    return {
      actionId: "enablePermission",
      summary: `Enabled controlled permission mode for ${session.sessionId}.`
    };
  }

  async readFile({ relativePath }) {
    return {
      actionId: "read",
      summary: `Read ${relativePath}.`,
      relativePath,
      content: "controlled telegram fixture"
    };
  }
}

function createFakeTelegramClient() {
  return {
    async getUpdates() {
      return [];
    },
    async sendMessage() {
      return { message_id: 1 };
    }
  };
}

export async function runTelegramEntryTests(runCase) {
  await runCase("builds Telegram runtime config from environment overrides", async () => {
    const tempDir = createTempDir("telegram-config");
    const config = createTelegramRuntimeConfigFromEnv({
      cwd: process.cwd(),
      env: {
        TG_BOT_TOKEN: "bot-token-demo",
        TG_ALLOWED_CHAT_IDS: "42,84",
        TG_DEFAULT_CHAT_ID: "42",
        TG_POLL_INTERVAL_MS: "1500",
        TG_LONG_POLL_TIMEOUT_SEC: "25",
        TG_COMMAND_DISPATCH_MODE: "sync",
        TG_MAX_MESSAGE_LENGTH: "3800",
        TG_TRANSPORT: "powershell",
        CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS: "F:/project,D:/workspace",
        CODEX_PUPPETEER_STORAGE_DIR: `${tempDir}/runtime`,
        CODEX_PUPPETEER_DEFAULT_PERMISSION_MODE: "auto",
        CODEX_PUPPETEER_CODEX_EXEC_PROFILE: "safe",
        CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE: "dangerous",
        CODEX_PUPPETEER_CODEX_SANDBOX: "danger-full-access",
        CODEX_PUPPETEER_WAIT_TIMEOUT_MS: "180000",
        CODEX_PUPPETEER_SEND_WAIT_TIMEOUT_MS: "480000"
      }
    });

    assert.equal(config.telegram.botToken, "bot-token-demo");
    assert.deepEqual(config.telegram.allowedChatIds, ["42", "84"]);
    assert.deepEqual(config.security.allowedSources, ["42", "84"]);
    assert.deepEqual(config.security.allowedProjectRoots, ["F:/project", "D:/workspace"]);
    assert.equal(config.telegram.defaultRecipient, "42");
    assert.equal(config.telegram.pollIntervalMs, 1500);
    assert.equal(config.telegram.longPollTimeoutSec, 25);
    assert.equal(config.telegram.commandDispatchMode, "sync");
    assert.equal(config.telegram.maxMessageLength, 3800);
    assert.equal(config.telegram.transport, "powershell");
    assert.equal(config.runtime.defaultPermissionMode, "auto");
    assert.equal(config.runtime.defaultExecProfile, "safe");
    assert.equal(config.runtime.autoPermissionExecProfile, "dangerous");
    assert.equal(config.runtime.codexSandboxMode, "danger-full-access");
    assert.equal(config.runtime.defaultWaitTimeoutMs, 180000);
    assert.equal(config.runtime.defaultSendWaitTimeoutMs, 480000);
    assert.match(config.runtime.sessionsFilePath, /sessions\.json$/);
    assert.match(config.runtime.tasksFilePath, /tasks\.json$/);
    assert.match(config.runtime.sourceBindingsFilePath, /source-bindings\.json$/);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await runCase("starts Telegram polling runtime without entering the loop when disabled", async () => {
    const tempDir = createTempDir("telegram-runtime");
    const runtime = await startTelegramPollingRuntime({
      env: {
        TG_BOT_TOKEN: "bot-token-demo",
        TG_ALLOWED_CHAT_IDS: "42",
        TG_TRANSPORT: "fetch",
        CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS: "F:/project",
        CODEX_PUPPETEER_STORAGE_DIR: `${tempDir}/runtime`
      },
      client: createFakeTelegramClient(),
      startLoop: false
    });

    assert.equal(runtime.config.telegram.botToken, "bot-token-demo");
    assert.deepEqual(runtime.config.security.allowedSources, ["42"]);
    assert.deepEqual(runtime.config.security.allowedProjectRoots, ["F:/project"]);
    assert.equal(runtime.config.telegram.transport, "fetch");
    assert.equal(runtime.capabilities.activeNotificationEnabled, true);
    assert.ok(runtime.repository);
    assert.ok(runtime.sessionRepository);
    assert.ok(runtime.sourceBindingRepository);
    assert.equal(runtime.recovery?.recoveredSessionCount, 0);
    runtime.stop();
    await runtime.loopPromise;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await runCase("persists Telegram sessions and source bindings across runtime restarts", async () => {
    const tempDir = createTempDir("telegram-persistence");
    const env = {
      TG_BOT_TOKEN: "bot-token-demo",
      TG_ALLOWED_CHAT_IDS: "42",
      TG_TRANSPORT: "fetch",
      CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS: "F:/project",
      CODEX_PUPPETEER_STORAGE_DIR: `${tempDir}/runtime`
    };

    const firstAdapter = new ControlledExecTelegramAdapter();
    const firstRuntime = await startTelegramPollingRuntime({
      env,
      client: createFakeTelegramClient(),
      codexAdapter: firstAdapter,
      startLoop: false
    });

    const createResult = await firstRuntime.agent.receiveText({
      sourceId: "42",
      messageId: "msg-1",
      content: "/create -n DemoProject -w demo"
    });
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await firstRuntime.agent.receiveText({
      sourceId: "42",
      messageId: "msg-2",
      content: `/send -n ${sessionId} -m \"First prompt\"`
    });

    assert.equal(sendResult.ok, true);
    await delay(40);

    const persistedSession = firstRuntime.sessionRepository.getSession(sessionId);
    const persistedBinding = firstRuntime.sourceBindingRepository.getBinding("42");
    assert.equal(persistedSession.status, "ready");
    assert.equal(persistedSession.codexThreadId, "thread-1");
    assert.equal(persistedBinding.sessionId, sessionId);

    firstRuntime.stop();
    await firstRuntime.loopPromise;

    const secondAdapter = new ControlledExecTelegramAdapter();
    const secondRuntime = await startTelegramPollingRuntime({
      env,
      client: createFakeTelegramClient(),
      codexAdapter: secondAdapter,
      startLoop: false
    });

    const restoredSession = secondRuntime.sessionRepository.getSession(sessionId);
    const restoredBinding = secondRuntime.sourceBindingRepository.getBinding("42");
    assert.equal(restoredSession.status, "ready");
    assert.equal(restoredSession.codexThreadId, "thread-1");
    assert.equal(restoredBinding.sessionId, sessionId);
    assert.equal(secondRuntime.recovery?.recoveredSessionCount, 0);

    const continueResult = await secondRuntime.agent.receiveText({
      sourceId: "42",
      messageId: "msg-3",
      content: "Continue yesterday's task"
    });

    assert.equal(continueResult.ok, true);
    await delay(40);
    assert.equal(secondAdapter.sentPrompts.length, 1);
    assert.equal(secondAdapter.sentPrompts[0].sessionId, sessionId);
    assert.equal(secondAdapter.sentPrompts[0].resumedThreadId, "thread-1");

    secondRuntime.stop();
    await secondRuntime.loopPromise;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}
