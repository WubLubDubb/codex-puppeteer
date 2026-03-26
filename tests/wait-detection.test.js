import assert from "node:assert/strict";

import { createDefaultAgent } from "../src/automation-agent.js";
import { defaultConfig } from "../src/default-config.js";

function buildMessage(content, sourceId = "owner.wechat") {
  return {
    sourceId,
    messageId: `msg-${Math.random().toString(16).slice(2)}`,
    content
  };
}

function buildAgentConfig(runtimeOverrides = {}) {
  const config = structuredClone(defaultConfig);
  Object.assign(config.runtime, runtimeOverrides);
  return config;
}

class ControlledCodexAdapter {
  constructor({ outputPlan = [], sendSessionStatus = "running" } = {}) {
    this.outputPlan = outputPlan;
    this.sendSessionStatus = sendSessionStatus;
    this.sessions = new Map();
  }

  async createSession({ session, hooks = {} }) {
    this.sessions.set(session.sessionId, { hooks });

    return {
      actionId: "create",
      summary: `Started controlled session ${session.sessionId} for ${session.projectName}.`,
      pid: null,
      launchMode: session.launchMode,
      driver: "exec-json",
      sessionStatus: "ready",
      output: ["Controlled Codex session ready."]
    };
  }

  async sendPrompt({ session, prompt, hooks = {} }) {
    const runtime = this.sessions.get(session.sessionId) ?? { hooks: {} };
    runtime.hooks = hooks;
    this.sessions.set(session.sessionId, runtime);

    for (const step of this.outputPlan) {
      setTimeout(() => {
        if (typeof step.content === "string") {
          runtime?.hooks?.onOutput?.({
            stream: step.stream ?? "stdout",
            content: step.content.replaceAll("{prompt}", prompt)
          });
        }

        if (step.exit) {
          runtime?.hooks?.onExit?.({
            exitCode: step.exitCode ?? 0,
            signal: step.signal ?? null,
            nextStatus: step.nextStatus ?? "ready",
            preserveBinding: step.preserveBinding ?? true,
            metadata: structuredClone(step.exitMetadata ?? {})
          });
        }
      }, step.afterMs);
    }

    return {
      actionId: "send",
      summary: `Prompt sent to controlled session ${session.sessionId}.`,
      pid: this.sendSessionStatus === "running" ? 12345 : null,
      driver: "exec-json",
      sessionStatus: this.sendSessionStatus
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
      summary: `Enabled controlled auto-confirm mode for ${session.sessionId}.`
    };
  }

  async readFile({ absolutePath, relativePath }) {
    return {
      actionId: "read",
      summary: `Prepared ${relativePath} as an attachment.`,
      relativePath,
      absolutePath,
      fileName: "fixture.txt",
      fileSizeBytes: 7,
      attachment: {
        kind: "document",
        filePath: absolutePath,
        fileName: "fixture.txt"
      }
    };
  }
}

export async function runWaitDetectionTests(runCase) {
  await runCase("returns ui_only_activity from /send when only Codex chrome/status lines appear", async () => {
    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultWaitIdleMs: 40,
        defaultWaitTimeoutMs: 160,
        defaultSendWaitTimeoutMs: 160,
        defaultWaitPollMs: 10
      }),
      codexAdapter: new ControlledCodexAdapter({
        outputPlan: [
          { afterMs: 20, content: "gpt-5.4 xhigh" },
          { afterMs: 40, content: "Press enter to continue" }
        ]
      })
    });
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Build release notes"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "timeout");
    assert.equal(sendResult.task.response.completionState, "ui_only_activity");
    assert.equal(sendResult.task.response.meaningfulLineCount, 0);
    assert.deepEqual(sendResult.task.response.assistantLines, []);
  });
}
