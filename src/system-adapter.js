import os from "node:os";
import { spawn } from "node:child_process";

import { AdapterExecutionError, ConfigurationError } from "./errors.js";

function now() {
  return new Date().toISOString();
}

function createIdlePlan() {
  return {
    mode: null,
    status: "idle",
    armedAt: null,
    executedAt: null,
    command: null
  };
}

function buildSystemCommand({ platform, action }) {
  if (platform === "win32") {
    if (action === "shutdown") {
      return {
        command: "shutdown",
        args: ["/s", "/t", "0"],
        description: "Windows immediate shutdown"
      };
    }

    if (action === "cancel") {
      return {
        command: "shutdown",
        args: ["/a"],
        description: "Windows cancel shutdown"
      };
    }
  }

  if (platform === "darwin") {
    if (action === "shutdown") {
      return {
        command: "shutdown",
        args: ["-h", "now"],
        description: "macOS immediate shutdown"
      };
    }
  }

  if (platform === "linux") {
    if (action === "shutdown") {
      return {
        command: "shutdown",
        args: ["-h", "now"],
        description: "Linux immediate shutdown"
      };
    }
  }

  throw new ConfigurationError(
    `Unsupported system action \"${action}\" on platform \"${platform}\".`,
    "system_action_unsupported",
    {
      platform,
      action
    }
  );
}

function runHostCommand(commandSpec, { spawnFactory = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let stdout = "";
    let stderr = "";

    try {
      child = spawnFactory(commandSpec.command, commandSpec.args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${commandSpec.command} exited with ${code}.`));
    });
  });
}

class BaseSystemAdapter {
  constructor({ osModule = os, platform = process.platform } = {}) {
    this.osModule = osModule;
    this.platform = platform;
    this.shutdownPlan = createIdlePlan();
  }

  async getSystemStatus({ sessions = [] } = {}) {
    const cpus = this.osModule.cpus?.() ?? [];
    const activeSessions = sessions.filter((session) => ["starting", "running"].includes(session.status));

    return {
      actionId: "sys",
      summary: `System probe collected. ${activeSessions.length} active session(s).`,
      snapshot: {
        platform: this.platform,
        cpuCount: cpus.length,
        loadAverage: this.osModule.loadavg?.() ?? [],
        totalMemory: this.osModule.totalmem?.() ?? 0,
        freeMemory: this.osModule.freemem?.() ?? 0,
        activeSessions: activeSessions.length,
        shutdownPlan: this.getShutdownPlan()
      }
    };
  }

  async armShutdown({ activeSessionCount }) {
    const timestamp = now();
    this.shutdownPlan = {
      mode: "when_idle",
      status: activeSessionCount === 0 ? "ready" : "armed",
      armedAt: timestamp,
      executedAt: null,
      command: null
    };

    return {
      actionId: "shutdown",
      summary:
        activeSessionCount === 0
          ? "Shutdown watch mode armed. No active sessions remain, so shutdown is ready to execute."
          : `Shutdown watch mode armed. Waiting for ${activeSessionCount} active session(s) to finish.`,
      plan: this.getShutdownPlan()
    };
  }

  getShutdownPlan() {
    return structuredClone(this.shutdownPlan);
  }
}

export class DryRunSystemAdapter extends BaseSystemAdapter {
  async shutdownNow({ activeSessionCount }) {
    const timestamp = now();
    this.shutdownPlan = {
      mode: "immediate",
      status: "executed",
      armedAt: timestamp,
      executedAt: timestamp,
      command: null
    };

    return {
      actionId: "shutdown",
      summary: `Dry run: would shut down now after handling ${activeSessionCount} active session(s).`,
      plan: this.getShutdownPlan()
    };
  }

  async cancelShutdown() {
    const hadActivePlan = this.shutdownPlan.status !== "idle";
    this.shutdownPlan = createIdlePlan();

    return {
      actionId: "cancel_shutdown",
      summary: hadActivePlan ? "Cancelled the pending shutdown plan." : "No shutdown plan was active.",
      plan: this.getShutdownPlan()
    };
  }

  async executeArmedShutdownIfReady({ activeSessionCount }) {
    if (this.shutdownPlan.mode !== "when_idle") {
      return null;
    }

    if (!["armed", "ready"].includes(this.shutdownPlan.status) || activeSessionCount > 0) {
      return null;
    }

    this.shutdownPlan = {
      ...this.shutdownPlan,
      status: "executed",
      executedAt: now()
    };

    return {
      actionId: "shutdown",
      summary: "Dry run: all sessions have exited, so the armed shutdown would execute now.",
      plan: this.getShutdownPlan()
    };
  }
}

export class HostSystemAdapter extends BaseSystemAdapter {
  constructor({
    osModule = os,
    platform = process.platform,
    spawnFactory = spawn,
    commandRunner = (commandSpec) => runHostCommand(commandSpec, { spawnFactory })
  } = {}) {
    super({ osModule, platform });
    this.commandRunner = commandRunner;
  }

  async shutdownNow({ activeSessionCount }) {
    const timestamp = now();
    const command = buildSystemCommand({ platform: this.platform, action: "shutdown" });

    await this.#runCommand(command, "system_shutdown_failed");

    this.shutdownPlan = {
      mode: "immediate",
      status: "executed",
      armedAt: timestamp,
      executedAt: timestamp,
      command
    };

    return {
      actionId: "shutdown",
      summary: `Executed host shutdown command after handling ${activeSessionCount} active session(s).`,
      plan: this.getShutdownPlan(),
      command
    };
  }

  async cancelShutdown() {
    const hadActivePlan = this.shutdownPlan.status !== "idle";

    if (!hadActivePlan) {
      return {
        actionId: "cancel_shutdown",
        summary: "No shutdown plan was active.",
        plan: this.getShutdownPlan()
      };
    }

    if (this.shutdownPlan.status === "executed") {
      const command = buildSystemCommand({ platform: this.platform, action: "cancel" });
      await this.#runCommand(command, "system_cancel_shutdown_failed");
    }

    this.shutdownPlan = createIdlePlan();
    return {
      actionId: "cancel_shutdown",
      summary: "Cancelled the pending shutdown plan.",
      plan: this.getShutdownPlan()
    };
  }

  async executeArmedShutdownIfReady({ activeSessionCount }) {
    if (this.shutdownPlan.mode !== "when_idle") {
      return null;
    }

    if (!["armed", "ready"].includes(this.shutdownPlan.status) || activeSessionCount > 0) {
      return null;
    }

    const command = buildSystemCommand({ platform: this.platform, action: "shutdown" });
    await this.#runCommand(command, "system_shutdown_failed");

    this.shutdownPlan = {
      ...this.shutdownPlan,
      status: "executed",
      executedAt: now(),
      command
    };

    return {
      actionId: "shutdown",
      summary: "All sessions have exited, so the armed shutdown command was executed.",
      plan: this.getShutdownPlan(),
      command
    };
  }

  async #runCommand(command, errorCode) {
    try {
      return await this.commandRunner(command);
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to execute host system command: ${error.message}`,
        errorCode,
        {
          platform: this.platform,
          command
        }
      );
    }
  }
}

export function createSystemAdapter({ mode = "dry-run", ...options } = {}) {
  if (mode === "dry-run") {
    return new DryRunSystemAdapter(options);
  }

  if (mode === "real") {
    return new HostSystemAdapter(options);
  }

  throw new ConfigurationError(`Unsupported system adapter mode \"${mode}\".`, "system_mode_invalid", {
    mode
  });
}

export { buildSystemCommand };
