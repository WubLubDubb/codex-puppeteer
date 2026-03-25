import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import * as pty from "node-pty";

import { AdapterExecutionError, ConfigurationError } from "./errors.js";

const supportedExecProfiles = new Set(["safe", "full-auto", "dangerous"]);
const supportedSandboxModes = new Set(["read-only", "workspace-write", "danger-full-access"]);

function normalizePermissionMode(value) {
  return String(value ?? "").trim().toLowerCase() === "auto" ? "auto" : "manual";
}

function resolveExecProfile(value, { fallback = "safe", optionName = "exec profile" } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (supportedExecProfiles.has(normalized)) {
    return normalized;
  }

  throw new ConfigurationError(
    `Unsupported ${optionName} value "${value}".`,
    "codex_exec_profile_invalid",
    { optionName, value }
  );
}

function resolveSandboxMode(value, { fallback = null } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (supportedSandboxModes.has(normalized)) {
    return normalized;
  }

  throw new ConfigurationError(
    `Unsupported CODEX_PUPPETEER_CODEX_SANDBOX value "${value}".`,
    "codex_sandbox_mode_invalid",
    { value }
  );
}

function describeExecStrategy({ execProfile, sandboxMode }) {
  if (execProfile === "dangerous") {
    return "dangerous (bypass approvals and sandbox)";
  }

  return sandboxMode ? `${execProfile}, sandbox=${sandboxMode}` : execProfile;
}

function ensurePrompt(prompt) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new AdapterExecutionError(
      "The -m flag is required when sending a prompt to a Codex session.",
      "codex_prompt_missing"
    );
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(content) {
  return String(content ?? "")
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function joinStartupOutput(startupOutput) {
  return stripAnsi(
    startupOutput
      .map((entry) => entry.content)
      .join("")
  ).trim();
}

function resolveTerminalCommand({ env = process.env, platform = process.platform } = {}) {
  if (platform === "win32") {
    return env.COMSPEC ?? "cmd.exe";
  }

  return env.SHELL ?? "/bin/bash";
}

function resolvePowerShellCommand({ env = process.env } = {}) {
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  return (
    env.CODEX_PUPPETEER_POWERSHELL ??
    env.POWERSHELL_EXE ??
    `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  );
}

function quoteShellArgument(argument, platform) {
  const value = String(argument ?? "");

  if (value === "") {
    return platform === "win32" ? '""' : "''";
  }

  if (platform === "win32") {
    return /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  return /[^A-Za-z0-9_./:=+-]/.test(value) ? `'${value.replace(/'/g, `"'"'`)}'` : value;
}

function buildTerminalLaunchCommand({ command, commandArgs, platform }) {
  return [command, ...commandArgs]
    .map((entry) => quoteShellArgument(entry, platform))
    .join(" ");
}

function buildTerminalLaunchArgs({ command, commandArgs, platform }) {
  const launchCommand = buildTerminalLaunchCommand({
    command,
    commandArgs,
    platform
  });

  if (platform === "win32") {
    return ["/d", "/c", launchCommand];
  }

  return ["-lc", launchCommand];
}

function buildSpawnSpec({ command, commandArgs = [], platform, env = process.env }) {
  if (platform !== "win32") {
    return {
      command,
      args: commandArgs
    };
  }

  const normalizedCommand = String(command ?? "").trim();
  const extensionMatch = /\.([A-Za-z0-9]+)$/.exec(normalizedCommand);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "";

  if (["exe", "com"].includes(extension)) {
    return {
      command: normalizedCommand,
      args: commandArgs
    };
  }

  if (extension === "ps1") {
    return {
      command: resolvePowerShellCommand({ env }),
      args: ["-ExecutionPolicy", "Bypass", "-File", normalizedCommand, ...commandArgs]
    };
  }

  return {
    command: resolveTerminalCommand({ env, platform }),
    args: [
      "/d",
      "/s",
      "/c",
      buildTerminalLaunchCommand({
        command: normalizedCommand,
        commandArgs,
        platform
      })
    ]
  };
}

function containsCommandNotFound(startupText, platform) {
  if (!startupText) {
    return false;
  }

  const patterns =
    platform === "win32"
      ? [
          /is not recognized as an internal or external command/i,
          /The system cannot find the path specified/i
        ]
      : [/command not found/i, /No such file or directory/i];

  return patterns.some((pattern) => pattern.test(startupText));
}

async function killWindowsProcessTree(pid, { spawnFactory = spawn } = {}) {
  await new Promise((resolve, reject) => {
    let stderr = "";
    let killer;

    try {
      killer = spawnFactory("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        shell: false
      });
    } catch (error) {
      reject(error);
      return;
    }

    killer.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    killer.once("error", (error) => {
      reject(error);
    });

    killer.once("exit", (code) => {
      if (
        code === 0 ||
        /There is no running instance of the task/i.test(stderr) ||
        /not found/i.test(stderr) ||
        /cannot find/i.test(stderr)
      ) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `taskkill exited with code ${code ?? "null"}.`));
    });
  });
}

export function resolveCodexCliCommand({ env = process.env } = {}) {
  return env.CODEX_PUPPETEER_CODEX_CLI ?? env.CODEX_CLI ?? "codex";
}

export function supportsRealCodexControl({ env = process.env, platform = process.platform } = {}) {
  return ["win32", "darwin", "linux"].includes(platform) && Boolean(resolveCodexCliCommand({ env }));
}

async function readUtf8File(absolutePath) {
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    throw new AdapterExecutionError(
      `Failed to read file "${absolutePath}": ${error.message}`,
      "session_file_read_failed",
      { absolutePath }
    );
  }
}

function resolveUserHomeDir({ env = process.env, platform = process.platform } = {}) {
  if (platform === "win32") {
    return (
      env.USERPROFILE ??
      (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : null) ??
      env.HOME ??
      null
    );
  }

  return env.HOME ?? null;
}

export function resolveCodexStateDir({ env = process.env, platform = process.platform } = {}) {
  if (typeof env.CODEX_PUPPETEER_CODEX_HOME === "string" && env.CODEX_PUPPETEER_CODEX_HOME.trim()) {
    return env.CODEX_PUPPETEER_CODEX_HOME.trim();
  }

  if (typeof env.CODEX_HOME === "string" && env.CODEX_HOME.trim()) {
    return env.CODEX_HOME.trim();
  }

  const homeDir = resolveUserHomeDir({ env, platform });
  return homeDir ? path.join(homeDir, ".codex") : null;
}

function normalizeThreadTitle(value) {
  const title = String(value ?? "").replace(/\s+/g, " ").trim();
  return title || "(untitled conversation)";
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compareUpdatedAtDescending(left, right) {
  const leftMs = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightMs = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  return rightMs - leftMs;
}

async function readLocalCodexConversationIndex({
  env = process.env,
  platform = process.platform
} = {}) {
  const stateDir = resolveCodexStateDir({ env, platform });
  if (!stateDir) {
    return {
      conversations: [],
      totalCount: 0,
      stateDir: null,
      sessionIndexPath: null
    };
  }

  const sessionIndexPath = path.join(stateDir, "session_index.jsonl");
  let content;

  try {
    content = await fs.readFile(sessionIndexPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        conversations: [],
        totalCount: 0,
        stateDir,
        sessionIndexPath
      };
    }

    throw new AdapterExecutionError(
      `Failed to read local Codex session index "${sessionIndexPath}": ${error.message}`,
      "codex_session_index_read_failed",
      {
        stateDir,
        sessionIndexPath
      }
    );
  }

  const conversationsById = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const codexSessionId = typeof parsed?.id === "string" ? parsed.id.trim() : "";
    if (!codexSessionId) {
      continue;
    }

    const nextConversation = {
      codexSessionId,
      title: normalizeThreadTitle(parsed?.thread_name),
      updatedAt: normalizeIsoTimestamp(parsed?.updated_at)
    };
    const existingConversation = conversationsById.get(codexSessionId);

    if (!existingConversation || compareUpdatedAtDescending(existingConversation, nextConversation) > 0) {
      conversationsById.set(codexSessionId, nextConversation);
    }
  }

  const conversations = Array.from(conversationsById.values()).sort(compareUpdatedAtDescending);
  return {
    conversations,
    totalCount: conversations.length,
    stateDir,
    sessionIndexPath
  };
}
export class SimulatedCodexAdapter {
  async listLocalSessions() {
    return {
      conversations: [],
      totalCount: 0,
      stateDir: null,
      sessionIndexPath: null
    };
  }

  async createSession({ session }) {
    return {
      actionId: "create",
      summary: `Started simulated Codex session ${session.sessionId} for ${session.projectName}.`,
      launchMode: session.launchMode,
      driver: "simulated",
      sessionStatus: "ready",
      output: [
        `Simulated Codex session ${session.sessionId} started in ${session.projectRoot}.`,
        "Simulated Codex is ready to accept prompts."
      ]
    };
  }

  async sendPrompt({ session, prompt }) {
    ensurePrompt(prompt);

    return {
      actionId: "send",
      summary: `Prompt sent to simulated session ${session.sessionId}.`,
      driver: "simulated",
      sessionStatus: "ready",
      output: [
        `> ${prompt}`,
        `Simulated Codex response for ${session.projectName}: prompt received.`
      ]
    };
  }

  async killSession({ session }) {
    return {
      actionId: "kill",
      summary: `Stopped simulated session ${session.sessionId}.`
    };
  }

  async enablePermission({ session }) {
    return {
      actionId: "enablePermission",
      summary: `Enabled simulated auto-confirm mode for ${session.sessionId}.`
    };
  }

  async disablePermission({ session }) {
    return {
      actionId: "disablePermission",
      summary: `Restored simulated default execution mode for ${session.sessionId}.`
    };
  }

  async readFile({ absolutePath, relativePath }) {
    const content = await readUtf8File(absolutePath);

    return {
      actionId: "read",
      summary: `Read ${relativePath}.`,
      relativePath,
      content
    };
  }
}

function extractAgentMessageText(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (typeof item.text === "string") {
    return item.text.trim();
  }

  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

export class ExecCodexAdapter {
  constructor({
    command = resolveCodexCliCommand(),
    env = process.env,
    platform = process.platform,
    spawnFactory = spawn,
    execArgs = ["--skip-git-repo-check"],
    defaultExecProfile,
    autoPermissionExecProfile,
    sandboxMode
  } = {}) {
    this.command = command;
    this.env = env;
    this.platform = platform;
    this.spawnFactory = spawnFactory;
    this.execArgs = execArgs;
    this.defaultExecProfile = resolveExecProfile(
      defaultExecProfile ?? env.CODEX_PUPPETEER_CODEX_EXEC_PROFILE,
      { fallback: "safe", optionName: "CODEX_PUPPETEER_CODEX_EXEC_PROFILE" }
    );
    this.autoPermissionExecProfile = resolveExecProfile(
      autoPermissionExecProfile ?? env.CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE,
      { fallback: "full-auto", optionName: "CODEX_PUPPETEER_CODEX_AUTO_PERMISSION_PROFILE" }
    );
    this.sandboxMode = resolveSandboxMode(
      sandboxMode ?? env.CODEX_PUPPETEER_CODEX_SANDBOX,
      { fallback: null }
    );
    this.sessions = new Map();
  }

  isAvailable() {
    return ["win32", "darwin", "linux"].includes(this.platform) && Boolean(this.command);
  }

  async listLocalSessions() {
    return readLocalCodexConversationIndex({
      env: this.env,
      platform: this.platform
    });
  }

  async createSession({ session }) {
    if (!this.isAvailable()) {
      throw new AdapterExecutionError(
        "No usable Codex CLI command is configured for exec mode.",
        "codex_cli_unavailable"
      );
    }

    return {
      actionId: "create",
      summary: `Created resumable Codex session ${session.sessionId} for ${session.projectName}.`,
      launchMode: session.launchMode,
      driver: "exec-json",
      sessionStatus: "ready"
    };
  }

  async sendPrompt({ session, prompt, hooks = {} }) {
    ensurePrompt(prompt);

    if (!this.isAvailable()) {
      throw new AdapterExecutionError(
        "No usable Codex CLI command is configured for exec mode.",
        "codex_cli_unavailable"
      );
    }

    const activeRuntime = this.sessions.get(session.sessionId);
    if (activeRuntime?.child) {
      throw new AdapterExecutionError(
        `Session ${session.sessionId} is already executing a Codex task. Wait for it to finish before sending another prompt.`,
        "codex_session_busy",
        { sessionId: session.sessionId }
      );
    }

    const executionStrategy = this.#resolveExecutionStrategy(session);
    const codexArgs = this.#buildExecArgs({
      prompt,
      threadId: session.codexThreadId ?? null,
      resumeMode: session.codexResumeMode ?? null,
      permissionMode: executionStrategy.permissionMode
    });
    const spawnSpec = buildSpawnSpec({
      command: this.command,
      commandArgs: codexArgs,
      platform: this.platform,
      env: this.env
    });

    let child;
    try {
      child = this.spawnFactory(spawnSpec.command, spawnSpec.args, {
        cwd: session.projectRoot,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: session.launchMode !== "foreground-debug",
        shell: false
      });
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to start Codex exec for session ${session.sessionId}: ${error.message}`,
        "codex_cli_start_failed",
        {
          sessionId: session.sessionId,
          command: this.command,
          args: codexArgs,
          spawnCommand: spawnSpec.command,
          spawnArgs: spawnSpec.args,
          projectRoot: session.projectRoot,
          driver: "exec-json"
        }
      );
    }

    const runtime = {
      child,
      hooks,
      stdoutBuffer: "",
      stderrBuffer: "",
      finalized: false
    };
    this.sessions.set(session.sessionId, runtime);
    this.#bindRuntime(session, runtime);

    return {
      actionId: "send",
      summary: `Prompt sent to session ${session.sessionId}.`,
      pid: child.pid ?? null,
      driver: "exec-json",
      sessionStatus: "running",
      permissionMode: executionStrategy.permissionMode,
      executionProfile: executionStrategy.execProfile,
      sandboxMode: executionStrategy.sandboxMode
    };
  }

  async killSession({ session }) {
    const runtime = this.sessions.get(session.sessionId);

    if (!runtime?.child) {
      return {
        actionId: "kill",
        summary: `Session ${session.sessionId} is already stopped.`
      };
    }

    try {
      runtime.child.kill();
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to stop session ${session.sessionId}: ${error.message}`,
        "codex_session_kill_failed",
        { sessionId: session.sessionId, driver: "exec-json" }
      );
    }

    return {
      actionId: "kill",
      summary: `Stop signal sent to session ${session.sessionId}.`
    };
  }

  async enablePermission({ session }) {
    const executionStrategy = this.#resolveExecutionStrategy({
      ...session,
      permissionMode: "auto"
    });

    return {
      actionId: "enablePermission",
      summary: `Permission mode switched for session ${session.sessionId}. Next runs will use ${describeExecStrategy(executionStrategy)}.`,
      permissionMode: executionStrategy.permissionMode,
      executionProfile: executionStrategy.execProfile,
      sandboxMode: executionStrategy.sandboxMode
    };
  }

  async disablePermission({ session }) {
    const executionStrategy = this.#resolveExecutionStrategy({
      ...session,
      permissionMode: "manual"
    });

    return {
      actionId: "disablePermission",
      summary: `Permission mode restored for session ${session.sessionId}. Next runs will use ${describeExecStrategy(executionStrategy)}.`,
      permissionMode: executionStrategy.permissionMode,
      executionProfile: executionStrategy.execProfile,
      sandboxMode: executionStrategy.sandboxMode
    };
  }

  async readFile({ absolutePath, relativePath }) {
    const content = await readUtf8File(absolutePath);

    return {
      actionId: "read",
      summary: `Read ${relativePath}.`,
      relativePath,
      content
    };
  }

  #resolveExecutionStrategy(session) {
    const permissionMode = normalizePermissionMode(session?.permissionMode);
    const execProfile =
      permissionMode === "auto" ? this.autoPermissionExecProfile : this.defaultExecProfile;

    return {
      permissionMode,
      execProfile,
      sandboxMode: execProfile === "dangerous" ? null : this.sandboxMode
    };
  }

  #buildExecArgs({ prompt, threadId, resumeMode, permissionMode }) {
    const args = ["exec"];

    if (resumeMode === "last") {
      args.push("resume", "--last");
    } else if (threadId) {
      args.push("resume", threadId);
    }

    const executionStrategy = this.#resolveExecutionStrategy({ permissionMode });
    args.push("--json");

    if (executionStrategy.execProfile === "full-auto") {
      args.push("--full-auto");
    } else if (executionStrategy.execProfile === "dangerous") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }

    if (executionStrategy.sandboxMode) {
      args.push("--sandbox", executionStrategy.sandboxMode);
    }

    args.push(prompt, ...this.execArgs);
    return args;
  }

  #bindRuntime(session, runtime) {
    const sessionId = session.sessionId;

    const finalize = ({ exitCode = null, signal = null } = {}) => {
      if (runtime.finalized) {
        return;
      }

      runtime.finalized = true;
      this.#flushBufferedLine(sessionId, runtime, "stdout");
      this.#flushBufferedLine(sessionId, runtime, "stderr");
      this.sessions.delete(sessionId);
      runtime.hooks.onExit?.({
        sessionId,
        exitCode,
        signal,
        nextStatus: "ready",
        preserveBinding: true,
        metadata: {
          driver: "exec-json"
        }
      });
    };

    runtime.child.stdout?.on("data", (chunk) => {
      this.#handleStreamChunk(sessionId, runtime, "stdout", chunk);
    });

    runtime.child.stderr?.on("data", (chunk) => {
      this.#handleStreamChunk(sessionId, runtime, "stderr", chunk);
    });

    runtime.child.on("error", (error) => {
      runtime.hooks.onOutput?.({
        sessionId,
        stream: "stderr",
        content: error.message
      });
      finalize({ exitCode: null, signal: null });
    });

    runtime.child.on("exit", (code, signal) => {
      finalize({ exitCode: code, signal });
    });
  }

  #handleStreamChunk(sessionId, runtime, stream, chunk) {
    const key = stream === "stderr" ? "stderrBuffer" : "stdoutBuffer";
    runtime[key] += chunk.toString();

    const lines = runtime[key].split(/\r?\n/);
    runtime[key] = lines.pop() ?? "";

    for (const line of lines) {
      this.#handleStreamLine(sessionId, runtime, stream, line);
    }
  }

  #flushBufferedLine(sessionId, runtime, stream) {
    const key = stream === "stderr" ? "stderrBuffer" : "stdoutBuffer";
    const remaining = runtime[key];
    runtime[key] = "";

    if (remaining) {
      this.#handleStreamLine(sessionId, runtime, stream, remaining);
    }
  }

  #handleStreamLine(sessionId, runtime, stream, line) {
    const content = String(line ?? "").trim();
    if (!content) {
      return;
    }

    if (stream === "stdout") {
      const event = this.#tryParseJson(content);
      if (event) {
        this.#handleJsonEvent(sessionId, runtime, event);
        return;
      }
    }

    runtime.hooks.onOutput?.({
      sessionId,
      stream,
      content
    });
  }

  #tryParseJson(line) {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  #handleJsonEvent(sessionId, runtime, event) {
    if (event?.type === "thread.started" && typeof event.thread_id === "string") {
      runtime.hooks.onMetadata?.({
        driver: "exec-json",
        codexThreadId: event.thread_id.trim(),
        codexResumeMode: null
      });
      return;
    }

    if (event?.type === "item.completed") {
      const messageText = extractAgentMessageText(event.item);
      if (messageText) {
        runtime.hooks.onOutput?.({
          sessionId,
          stream: "stdout",
          content: messageText
        });
      }
      return;
    }

    if (typeof event?.message === "string" && /error/i.test(event?.type ?? "")) {
      runtime.hooks.onOutput?.({
        sessionId,
        stream: "stderr",
        content: event.message
      });
    }
  }
}

export class SubprocessCodexAdapter {
  constructor({
    command = resolveCodexCliCommand(),
    env = process.env,
    platform = process.platform,
    spawnFactory = spawn,
    startupProbeMs = 800
  } = {}) {
    this.command = command;
    this.env = env;
    this.platform = platform;
    this.spawnFactory = spawnFactory;
    this.startupProbeMs = startupProbeMs;
    this.sessions = new Map();
  }

  isAvailable() {
    return ["win32", "darwin", "linux"].includes(this.platform) && Boolean(this.command);
  }

  async listLocalSessions() {
    return readLocalCodexConversationIndex({
      env: this.env,
      platform: this.platform
    });
  }

  async createSession({ session, hooks = {} }) {
    if (!this.isAvailable()) {
      throw new AdapterExecutionError(
        "No usable Codex CLI command is configured for subprocess mode.",
        "codex_cli_unavailable"
      );
    }

    if (this.sessions.has(session.sessionId)) {
      throw new AdapterExecutionError(
        `Session ${session.sessionId} already exists in the Codex adapter runtime.`,
        "codex_session_exists",
        { sessionId: session.sessionId }
      );
    }

    const spawnSpec = buildSpawnSpec({
      command: this.command,
      commandArgs: [],
      platform: this.platform,
      env: this.env
    });
    let child;

    try {
      child = this.spawnFactory(spawnSpec.command, spawnSpec.args, {
        cwd: session.projectRoot,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: session.launchMode !== "foreground-debug",
        shell: false
      });
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to start Codex CLI: ${error.message}`,
        "codex_cli_start_failed",
        { command: this.command, spawnCommand: spawnSpec.command, spawnArgs: spawnSpec.args, projectRoot: session.projectRoot }
      );
    }

    this.sessions.set(session.sessionId, { child });
    this.#bindRuntime(session.sessionId, child, hooks);
    await this.#awaitStartupProbe(session, child);

    return {
      actionId: "create",
      summary: `Started Codex session ${session.sessionId} in ${session.projectRoot}.`,
      pid: child.pid ?? null,
      launchMode: session.launchMode,
      driver: "pipe",
      sessionStatus: "running"
    };
  }

  async sendPrompt({ session, prompt }) {
    ensurePrompt(prompt);

    const runtime = this.sessions.get(session.sessionId);

    if (!runtime?.child?.stdin) {
      throw new AdapterExecutionError(
        `Session ${session.sessionId} is not writable because no live Codex process was found.`,
        "codex_session_not_running",
        { sessionId: session.sessionId }
      );
    }

    try {
      runtime.child.stdin.write(`${prompt}\n`);
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to write prompt to session ${session.sessionId}: ${error.message}`,
        "codex_session_write_failed",
        { sessionId: session.sessionId }
      );
    }

    return {
      actionId: "send",
      summary: `Prompt sent to session ${session.sessionId}.`
    };
  }

  async killSession({ session }) {
    const runtime = this.sessions.get(session.sessionId);

    if (!runtime?.child) {
      return {
        actionId: "kill",
        summary: `Session ${session.sessionId} is already stopped.`
      };
    }

    try {
      runtime.child.kill();
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to stop session ${session.sessionId}: ${error.message}`,
        "codex_session_kill_failed",
        { sessionId: session.sessionId }
      );
    }

    return {
      actionId: "kill",
      summary: `Stop signal sent to session ${session.sessionId}.`
    };
  }

  async enablePermission({ session }) {
    return {
      actionId: "enablePermission",
      summary: `Permission mode switched for session ${session.sessionId}.`
    };
  }

  async disablePermission({ session }) {
    return {
      actionId: "disablePermission",
      summary: `Permission mode restored for session ${session.sessionId}.`
    };
  }

  async readFile({ absolutePath, relativePath }) {
    const content = await readUtf8File(absolutePath);

    return {
      actionId: "read",
      summary: `Read ${relativePath}.`,
      relativePath,
      content
    };
  }

  #bindRuntime(sessionId, child, hooks) {
    child.stdout?.on("data", (chunk) => {
      hooks.onOutput?.({
        sessionId,
        stream: "stdout",
        content: chunk.toString()
      });
    });

    child.stderr?.on("data", (chunk) => {
      hooks.onOutput?.({
        sessionId,
        stream: "stderr",
        content: chunk.toString()
      });
    });

    child.on("error", (error) => {
      hooks.onOutput?.({
        sessionId,
        stream: "stderr",
        content: error.message
      });
    });

    child.on("exit", (code, signal) => {
      this.sessions.delete(sessionId);
      hooks.onExit?.({
        sessionId,
        exitCode: code,
        signal
      });
    });
  }

  async #awaitStartupProbe(session, child) {
    const startupOutput = [];

    const onStdout = (chunk) => {
      startupOutput.push({
        stream: "stdout",
        content: chunk.toString()
      });
    };

    const onStderr = (chunk) => {
      startupOutput.push({
        stream: "stderr",
        content: chunk.toString()
      });
    };

    let settled = false;
    let exitListener;

    const probeResult = await new Promise((resolve) => {
      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      exitListener = (code, signal) => {
        finish({
          exited: true,
          code,
          signal
        });
      };

      child.stdout?.on("data", onStdout);
      child.stderr?.on("data", onStderr);
      child.once("exit", exitListener);

      setTimeout(() => {
        finish({
          exited: false,
          code: null,
          signal: null
        });
      }, this.startupProbeMs);
    });

    child.stdout?.off("data", onStdout);
    child.stderr?.off("data", onStderr);

    if (!probeResult.exited && exitListener) {
      child.off("exit", exitListener);
    }

    const startupText = joinStartupOutput(startupOutput);

    if (!probeResult.exited) {
      return { startupText };
    }

    if (/stdin is not a terminal/i.test(startupText)) {
      throw new AdapterExecutionError(
        `Codex CLI requires a terminal-compatible session on ${this.platform}; the current pipe-based driver cannot keep "${session.sessionId}" alive.`,
        "codex_terminal_required",
        {
          platform: this.platform,
          sessionId: session.sessionId,
          command: this.command,
          startupOutput: startupText
        }
      );
    }

    throw new AdapterExecutionError(
      `Codex CLI exited during startup for session ${session.sessionId}.`,
      "codex_cli_startup_exited",
      {
        sessionId: session.sessionId,
        command: this.command,
        exitCode: probeResult.code,
        signal: probeResult.signal,
        startupOutput: startupText
      }
    );
  }
}

export class PtyCodexAdapter {
  constructor({
    command = resolveCodexCliCommand(),
    env = process.env,
    platform = process.platform,
    ptyFactory = pty.spawn,
    startupProbeMs = 1200,
    defaultCols = 120,
    defaultRows = 30,
    commandArgs = ["--no-alt-screen"],
    terminalCommand = resolveTerminalCommand({ env, platform }),
    terminalArgs = buildTerminalLaunchArgs({ command, commandArgs, platform }),
    killProcessTree = (pid) => killWindowsProcessTree(pid)
  } = {}) {
    this.command = command;
    this.env = env;
    this.platform = platform;
    this.ptyFactory = ptyFactory;
    this.startupProbeMs = startupProbeMs;
    this.defaultCols = defaultCols;
    this.defaultRows = defaultRows;
    this.commandArgs = commandArgs;
    this.terminalCommand = terminalCommand;
    this.terminalArgs = terminalArgs;
    this.killProcessTree = killProcessTree;
    this.sessions = new Map();
  }

  isAvailable() {
    return ["win32", "darwin", "linux"].includes(this.platform) && Boolean(this.command);
  }

  async listLocalSessions() {
    return readLocalCodexConversationIndex({
      env: this.env,
      platform: this.platform
    });
  }

  async createSession({ session, hooks = {} }) {
    if (!this.isAvailable()) {
      throw new AdapterExecutionError(
        "No usable Codex CLI command is configured for PTY mode.",
        "codex_cli_unavailable"
      );
    }

    if (this.sessions.has(session.sessionId)) {
      throw new AdapterExecutionError(
        `Session ${session.sessionId} already exists in the Codex adapter runtime.`,
        "codex_session_exists",
        { sessionId: session.sessionId }
      );
    }

    let terminal;

    try {
      const options = {
        name: this.platform === "win32" ? "xterm-color" : "xterm-256color",
        cols: this.defaultCols,
        rows: this.defaultRows,
        cwd: session.projectRoot,
        env: this.env
      };

      if (this.platform === "win32") {
        options.useConpty = true;
      }

      terminal = this.ptyFactory(this.terminalCommand, this.terminalArgs, options);
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to start Codex terminal session in PTY mode: ${error.message}`,
        "codex_cli_start_failed",
        {
          command: this.command,
          terminalCommand: this.terminalCommand,
          projectRoot: session.projectRoot
        }
      );
    }

    const runtime = { terminal, dataSubscription: null, exitSubscription: null };
    this.sessions.set(session.sessionId, runtime);
    this.#bindRuntime(session.sessionId, runtime, hooks);
    const startupResult = await this.#awaitStartupProbe(session, terminal);
    await this.#assertStartupHealthy(session, terminal, startupResult);
    await this.#dismissInitialTrustPromptIfNeeded(startupResult, terminal);

    return {
      actionId: "create",
      summary: `Started Codex session ${session.sessionId} in ${session.projectRoot}.`,
      pid: terminal.pid ?? null,
      launchMode: session.launchMode,
      driver: "pty-shell",
      sessionStatus: "running",
      terminalCommand: this.terminalCommand,
      terminalArgs: this.terminalArgs
    };
  }

  async sendPrompt({ session, prompt }) {
    ensurePrompt(prompt);

    const runtime = this.sessions.get(session.sessionId);

    if (!runtime?.terminal) {
      throw new AdapterExecutionError(
        `Session ${session.sessionId} is not writable because no live Codex PTY was found.`,
        "codex_session_not_running",
        { sessionId: session.sessionId }
      );
    }

    try {
      runtime.terminal.write(`${prompt}\r`);
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to write prompt to session ${session.sessionId}: ${error.message}`,
        "codex_session_write_failed",
        { sessionId: session.sessionId }
      );
    }

    return {
      actionId: "send",
      summary: `Prompt sent to session ${session.sessionId}.`
    };
  }

  async killSession({ session }) {
    const runtime = this.sessions.get(session.sessionId);

    if (!runtime?.terminal) {
      return {
        actionId: "kill",
        summary: `Session ${session.sessionId} is already stopped.`
      };
    }

    try {
      await this.#terminateTerminal(runtime.terminal);
      this.#disposeRuntime(session.sessionId, runtime);
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to stop session ${session.sessionId}: ${error.message}`,
        "codex_session_kill_failed",
        { sessionId: session.sessionId }
      );
    }

    return {
      actionId: "kill",
      summary: `Stop signal sent to session ${session.sessionId}.`
    };
  }

  async enablePermission({ session }) {
    return {
      actionId: "enablePermission",
      summary: `Permission mode switched for session ${session.sessionId}.`
    };
  }

  async disablePermission({ session }) {
    return {
      actionId: "disablePermission",
      summary: `Permission mode restored for session ${session.sessionId}.`
    };
  }

  async readFile({ absolutePath, relativePath }) {
    const content = await readUtf8File(absolutePath);

    return {
      actionId: "read",
      summary: `Read ${relativePath}.`,
      relativePath,
      content
    };
  }

  #bindRuntime(sessionId, runtime, hooks) {
    runtime.dataSubscription = runtime.terminal.onData((content) => {
      hooks.onOutput?.({
        sessionId,
        stream: "stdout",
        content
      });
    });

    runtime.exitSubscription = runtime.terminal.onExit((event) => {
      this.#disposeRuntime(sessionId, runtime);
      hooks.onExit?.({
        sessionId,
        exitCode: event.exitCode,
        signal: event.signal ?? null
      });
    });
  }

  async #awaitStartupProbe(session, terminal) {
    const startupOutput = [];

    let settled = false;
    let dataDisposable;
    let exitDisposable;

    const probeResult = await new Promise((resolve) => {
      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      dataDisposable = terminal.onData((content) => {
        startupOutput.push({
          stream: "stdout",
          content
        });
      });

      exitDisposable = terminal.onExit((event) => {
        finish({
          exited: true,
          code: event.exitCode,
          signal: event.signal ?? null
        });
      });

      setTimeout(() => {
        finish({
          exited: false,
          code: null,
          signal: null
        });
      }, this.startupProbeMs);
    });

    dataDisposable?.dispose?.();
    exitDisposable?.dispose?.();

    const startupText = joinStartupOutput(startupOutput);

    if (!probeResult.exited) {
      return { startupText };
    }

    if (/stdin is not a terminal/i.test(startupText)) {
      throw new AdapterExecutionError(
        `Codex CLI requires a terminal-compatible session on ${this.platform}; the current PTY driver still failed for "${session.sessionId}".`,
        "codex_terminal_required",
        {
          platform: this.platform,
          sessionId: session.sessionId,
          command: this.command,
          startupOutput: startupText,
          driver: "pty-shell"
        }
      );
    }

    throw new AdapterExecutionError(
      `Codex CLI exited during PTY startup for session ${session.sessionId}.`,
      "codex_cli_startup_exited",
      {
        sessionId: session.sessionId,
        command: this.command,
        exitCode: probeResult.code,
        signal: probeResult.signal,
        startupOutput: startupText,
        driver: "pty-shell"
      }
    );
  }

  async #assertStartupHealthy(session, terminal, startupResult) {
    const startupText = startupResult.startupText ?? "";

    if (/stdin is not a terminal/i.test(startupText)) {
      await this.#bestEffortTerminateTerminal(terminal);
      this.sessions.delete(session.sessionId);
      throw new AdapterExecutionError(
        `Codex CLI still reported missing terminal semantics for session ${session.sessionId}.`,
        "codex_terminal_required",
        {
          platform: this.platform,
          sessionId: session.sessionId,
          command: this.command,
          terminalCommand: this.terminalCommand,
          startupOutput: startupText,
          driver: "pty-shell"
        }
      );
    }

    if (!containsCommandNotFound(startupText, this.platform)) {
      return;
    }

    await this.#bestEffortTerminateTerminal(terminal);
    this.sessions.delete(session.sessionId);
    throw new AdapterExecutionError(
      `Failed to start Codex CLI inside the terminal session for ${session.sessionId}.`,
      "codex_cli_unavailable",
      {
        sessionId: session.sessionId,
        command: this.command,
        terminalCommand: this.terminalCommand,
        startupOutput: startupText,
        driver: "pty-shell"
      }
    );
  }

  async #dismissInitialTrustPromptIfNeeded(startupResult, terminal) {
    if (
      !/Do you trust the contents of this directory\?/i.test(startupResult.startupText) ||
      !/Press enter to continue/i.test(startupResult.startupText)
    ) {
      return;
    }

    terminal.write("\r");
    await delay(1500);
  }

  async #terminateTerminal(terminal) {
    if (this.platform === "win32" && terminal?.pid && typeof this.killProcessTree === "function") {
      await this.killProcessTree(terminal.pid);
      this.#releaseTerminalResources(terminal);
      return;
    }

    terminal.kill();
  }

  #disposeRuntime(sessionId, runtime) {
    runtime?.dataSubscription?.dispose?.();
    runtime?.exitSubscription?.dispose?.();
    this.#releaseTerminalResources(runtime?.terminal);
    this.sessions.delete(sessionId);
  }

  #releaseTerminalResources(terminal) {
    try {
      terminal?._socket?.removeAllListeners?.();
    } catch {}

    try {
      terminal?._socket?.destroy?.();
    } catch {}

    try {
      if (terminal?._agent?._closeTimeout) {
        clearTimeout(terminal._agent._closeTimeout);
      }
    } catch {}

    try {
      terminal?._agent?._inSocket?.destroy?.();
    } catch {}

    try {
      terminal?._agent?._outSocket?.destroy?.();
    } catch {}

    try {
      terminal?._agent?._conoutSocketWorker?.dispose?.();
    } catch {}
  }

  async #bestEffortTerminateTerminal(terminal) {
    try {
      await this.#terminateTerminal(terminal);
    } catch {
      // Ignore cleanup failures while surfacing the primary startup error.
    }
  }
}

export const VsCodeCodexAdapter = PtyCodexAdapter;

export function createPreferredCodexAdapter({
  env = process.env,
  platform = process.platform,
  command,
  spawnFactory = spawn,
  ptyFactory = pty.spawn,
  subprocessAdapterFactory = (options) => new SubprocessCodexAdapter(options),
  ptyAdapterFactory = (options) => new PtyCodexAdapter(options),
  execAdapterFactory = (options) => new ExecCodexAdapter(options),
  simulatedAdapterFactory = () => new SimulatedCodexAdapter()
} = {}) {
  const mode = (env.CODEX_PUPPETEER_CODEX_MODE ?? "auto").toLowerCase();
  const terminalDriver = (env.CODEX_PUPPETEER_TERMINAL_DRIVER ?? "exec").toLowerCase();

  if (!["auto", "real", "simulated"].includes(mode)) {
    throw new ConfigurationError(
      `Unsupported CODEX_PUPPETEER_CODEX_MODE value "${mode}".`,
      "codex_mode_invalid",
      { mode }
    );
  }

  if (!["exec", "pty", "pipe"].includes(terminalDriver)) {
    throw new ConfigurationError(
      `Unsupported CODEX_PUPPETEER_TERMINAL_DRIVER value "${terminalDriver}".`,
      "codex_terminal_driver_invalid",
      { terminalDriver }
    );
  }

  if (mode === "simulated") {
    return simulatedAdapterFactory();
  }

  const resolvedCommand = command ?? resolveCodexCliCommand({ env });

  if (mode === "real" && !resolvedCommand) {
    throw new ConfigurationError(
      "Real Codex control was requested, but no Codex CLI command is configured.",
      "codex_cli_missing",
      { platform }
    );
  }

  if (
    mode === "real" ||
    supportsRealCodexControl({ env: { ...env, CODEX_CLI: resolvedCommand }, platform })
  ) {
    const adapterOptions = {
      env,
      platform,
      command: resolvedCommand
    };

    if (terminalDriver === "pipe") {
      return subprocessAdapterFactory({
        ...adapterOptions,
        spawnFactory
      });
    }

    if (terminalDriver === "pty") {
      return ptyAdapterFactory({
        ...adapterOptions,
        ptyFactory
      });
    }

    return execAdapterFactory({
      ...adapterOptions,
      spawnFactory
    });
  }

  return simulatedAdapterFactory();
}




