import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function createWorkspaceTempDir(prefix) {
  const tempRoot = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  return fs.mkdtempSync(path.join(tempRoot, prefix));
}

class ControlledCodexAdapter {
  constructor({ outputPlan = [], sendSessionStatus = "running", localSessions = [] } = {}) {
    this.outputPlan = outputPlan;
    this.sendSessionStatus = sendSessionStatus;
    this.localSessions = localSessions;
    this.sessions = new Map();
    this.sentPrompts = [];
  }

  async listLocalSessions() {
    return {
      conversations: structuredClone(this.localSessions),
      totalCount: this.localSessions.length,
      stateDir: null,
      sessionIndexPath: null
    };
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
    this.sentPrompts.push({
      sessionId: session.sessionId,
      prompt,
      resumedThreadId: session.codexThreadId ?? null,
      resumeMode: session.codexResumeMode ?? null,
      permissionMode: session.permissionMode ?? null
    });

    for (const step of this.outputPlan) {
      setTimeout(() => {
        if (typeof step.content === "string") {
          runtime?.hooks?.onOutput?.({
            stream: step.stream ?? "stdout",
            content: step.content.replaceAll("{prompt}", prompt)
          });
        }

        if (step.metadata) {
          runtime?.hooks?.onMetadata?.(structuredClone(step.metadata));
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

  async disablePermission({ session }) {
    return {
      actionId: "disablePermission",
      summary: `Restored controlled default execution mode for ${session.sessionId}.`
    };
  }

  async readFile({ absolutePath, relativePath }) {
    return {
      actionId: "read",
      summary: `Prepared ${relativePath} as an attachment.`,
      relativePath,
      absolutePath,
      fileName: path.basename(absolutePath),
      fileSizeBytes: 128,
      attachment: {
        kind: "document",
        filePath: absolutePath,
        fileName: path.basename(absolutePath)
      }
    };
  }
}

export async function runAutomationAgentTests(runCase) {
  await runCase("creates and lists Codex sessions using the new session pool model", async () => {
    const agent = createDefaultAgent();
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));

    assert.equal(createResult.ok, true);
    assert.equal(createResult.task.status, "completed");
    assert.equal(createResult.task.response.actionId, "create");
    assert.equal(createResult.task.response.session.projectName, "DemoProject");
    assert.equal(createResult.task.response.session.status, "ready");

    const listResult = await agent.receiveText(buildMessage('/list'));

    assert.equal(listResult.ok, true);
    assert.equal(listResult.task.response.sessions.length, 1);
    assert.equal(
      listResult.task.response.sessions[0].sessionId,
      createResult.task.response.session.sessionId
    );
  });
  await runCase("renders help text that matches the current runtime behavior", async () => {
    const config = structuredClone(defaultConfig);
    config.security.allowedProjectRoots = ["F:/project"];
    config.runtime.defaultSendWaitTimeoutMs = 3600000;
    config.runtime.defaultWaitTimeoutMs = 120000;
    config.runtime.defaultPermissionMode = "manual";
    config.runtime.defaultExecProfile = "safe";
    config.runtime.autoPermissionExecProfile = "full-auto";
    config.runtime.codexSandboxMode = "workspace-write";
    config.system.actionMode = "dry-run";

    const agent = createDefaultAgent({ config });
    const result = await agent.receiveText(buildMessage('/help'));

    assert.equal(result.ok, true);
    assert.equal(result.task.response.actionId, "help");
    assert.match(result.task.resultSummary, /WxCodex Agent \/help/);
    assert.match(result.task.resultSummary, /\/projects/);
    assert.match(result.task.resultSummary, /\/create -n <name> -w <workspace>/);
    assert.match(result.task.resultSummary, /\/activate -n <sessionId\|codexConversationId\|listNumber> \[-w <workspace>\]/);
    assert.match(result.task.resultSummary, /\/send -n <sessionId\|codexConversationId\|listNumber> -m <prompt>/);
    assert.match(result.task.resultSummary, /\/disablePermission -n <sessionId\|listNumber>/);
    assert.match(result.task.resultSummary, /F:\\project/);
    assert.match(result.task.resultSummary, /60 分钟/);
    assert.match(result.task.resultSummary, /workspace-write/);
    assert.match(result.task.resultSummary, /\/wait 已废弃/);
    assert.doesNotMatch(result.task.resultSummary, /\/attach/);
  });


  await runCase("lists local Codex history even when no managed sessions exist", async () => {
    const agent = createDefaultAgent({
      codexAdapter: new ControlledCodexAdapter({
        localSessions: [
          {
            codexSessionId: "thread-100",
            title: "Review yesterday changes",
            updatedAt: "2026-03-23T10:00:00.000Z"
          }
        ]
      })
    });

    const result = await agent.receiveText(buildMessage("/list"));

    assert.equal(result.ok, true);
    assert.equal(result.task.response.sessions.length, 0);
    assert.equal(result.task.response.localCodexSessions.length, 1);
    assert.equal(result.task.response.localCodexSessions[0].codexSessionId, "thread-100");
    assert.match(result.task.resultSummary, /Current sessions \(0\):/);
    assert.match(result.task.resultSummary, /Recent history \(1\/1\):/);
    assert.match(result.task.resultSummary, /03-23 10:00/);
  });

  await runCase("lists managed sessions together with activated local Codex history", async () => {
    const agent = createDefaultAgent({
      codexAdapter: new ControlledCodexAdapter({
        localSessions: [
          {
            codexSessionId: "thread-123",
            title: "Existing history conversation",
            updatedAt: "2026-03-23T11:00:00.000Z"
          },
          {
            codexSessionId: "thread-999",
            title: "Another historical conversation",
            updatedAt: "2026-03-23T09:00:00.000Z"
          }
        ]
      })
    });

    const activateResult = await agent.receiveText(
      buildMessage('/activate -n thread-123 -w demo')
    );
    const createResult = await agent.receiveText(buildMessage('/create -n FreshProject -w demo'));
    const result = await agent.receiveText(buildMessage('/list'));

    assert.equal(activateResult.ok, true);
    assert.equal(activateResult.task.response.session.codexThreadId, 'thread-123');
    assert.equal(result.ok, true);
    assert.equal(result.task.response.sessions.length, 2);
    assert.equal(result.task.response.localCodexSessions.length, 1);
    assert.equal(result.task.response.localCodexSessions[0].codexSessionId, 'thread-999');
    assert.equal(result.task.response.activeSessionId, createResult.task.response.session.sessionId);
    assert.match(result.task.resultSummary, /Current sessions \(2\):/);
    assert.match(result.task.resultSummary, /Recent history \(1\/1\):/);
    assert.match(result.task.resultSummary, /codex=thread-123/);
    assert.doesNotMatch(result.task.resultSummary, / @ /);
  });

  await runCase("numbers /list entries and resolves later commands by those numbers", async () => {
    const adapter = new ControlledCodexAdapter({
      sendSessionStatus: "ready",
      localSessions: [
        {
          codexSessionId: "thread-222",
          title: "Resume this task",
          updatedAt: "2026-03-23T12:00:00.000Z"
        }
      ]
    });
    const agent = createDefaultAgent({ codexAdapter: adapter });

    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const managedSessionId = createResult.task.response.session.sessionId;
    const listResult = await agent.receiveText(buildMessage('/list'));

    assert.equal(listResult.ok, true);
    assert.deepEqual(
      listResult.task.response.selectionEntries.map(({ index, type, sessionId, codexSessionId }) => ({
        index,
        type,
        sessionId,
        codexSessionId
      })),
      [
        {
          index: 1,
          type: "managed",
          sessionId: managedSessionId,
          codexSessionId: null
        },
        {
          index: 2,
          type: "local",
          sessionId: null,
          codexSessionId: "thread-222"
        }
      ]
    );
    assert.match(listResult.task.resultSummary, /\* 1\. session-\d{4} \| DemoProject \| ready/i);
    assert.match(listResult.task.resultSummary, /\n2\. thread-222\n  03-23 12:00 \| Resume this task/);

    const screenResult = await agent.receiveText(buildMessage('/screen -n 1'));
    assert.equal(screenResult.ok, true);
    assert.equal(screenResult.task.response.sessionId, managedSessionId);

    const sendResult = await agent.receiveText(
      buildMessage('/send -n 2 -m "Continue implementation"')
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.session.codexThreadId, 'thread-222');
    assert.equal(adapter.sentPrompts.at(-1).resumedThreadId, 'thread-222');
  });

  await runCase("activates a managed session by /list number and routes plain text there", async () => {
    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultWaitIdleMs: 40,
        defaultWaitTimeoutMs: 240,
        defaultSendWaitTimeoutMs: 240,
        defaultWaitPollMs: 10
      }),
      codexAdapter: new ControlledCodexAdapter({
        outputPlan: [
          { afterMs: 20, content: "Echo {prompt}" },
          { afterMs: 40, exit: true, nextStatus: "ready", preserveBinding: true }
        ]
      })
    });

    const firstCreate = await agent.receiveText(buildMessage('/create -n ProjectOne -w demo'));
    const secondCreate = await agent.receiveText(buildMessage('/create -n ProjectTwo -w demo'));
    const secondSessionId = secondCreate.task.response.session.sessionId;

    const listBefore = await agent.receiveText(buildMessage('/list'));
    assert.equal(listBefore.ok, true);
    assert.equal(listBefore.task.response.activeSessionId, secondSessionId);

    const activateResult = await agent.receiveText(buildMessage('/activate -n 1'));

    assert.equal(activateResult.ok, true);
    assert.equal(activateResult.task.response.actionId, 'activate');
    assert.equal(activateResult.task.response.session.sessionId, firstCreate.task.response.session.sessionId);
    assert.match(activateResult.task.resultSummary, /Plain text will now be sent there/i);

    const implicitSendResult = await agent.receiveText(buildMessage('Switch target prompt'));

    assert.equal(implicitSendResult.ok, true);
    assert.equal(implicitSendResult.task.response.session.sessionId, firstCreate.task.response.session.sessionId);
    assert.match(implicitSendResult.task.response.assistantText, /Echo Switch target prompt/);

    const listAfter = await agent.receiveText(buildMessage('/list'));
    assert.equal(listAfter.task.response.activeSessionId, firstCreate.task.response.session.sessionId);
    assert.match(listAfter.task.resultSummary, /\* 1\. session-/i);
  });

  await runCase("rejects numbered local-history selections for managed-session commands", async () => {
    const agent = createDefaultAgent({
      codexAdapter: new ControlledCodexAdapter({
        localSessions: [
          {
            codexSessionId: "thread-333",
            title: "History only",
            updatedAt: "2026-03-23T13:00:00.000Z"
          }
        ]
      })
    });

    const listResult = await agent.receiveText(buildMessage('/list'));
    assert.equal(listResult.ok, true);
    assert.equal(listResult.task.response.selectionEntries.length, 1);
    assert.equal(listResult.task.response.selectionEntries[0].type, 'local');

    const screenResult = await agent.receiveText(buildMessage('/screen -n 1'));

    assert.equal(screenResult.ok, false);
    assert.equal(screenResult.task.status, 'rejected');
    assert.match(screenResult.task.resultSummary, /local Codex history/i);
    assert.match(screenResult.task.resultSummary, /\/activate -n 1/i);
  });

  await runCase("limits local Codex history output for mobile readability", async () => {
    const localSessions = Array.from({ length: 10 }, (_, index) => ({
      codexSessionId: `thread-${index + 1}`,
      title: `History item ${index + 1}` ,
      updatedAt: `2026-03-${String(index + 10).padStart(2, "0")}T10:00:00.000Z`
    }));

    const agent = createDefaultAgent({
      codexAdapter: new ControlledCodexAdapter({ localSessions })
    });

    const result = await agent.receiveText(buildMessage("/list"));

    assert.equal(result.ok, true);
    assert.equal(result.task.response.localCodexSessions.length, 8);
    assert.equal(result.task.response.omittedLocalCodexSessions, 2);
    assert.match(result.task.resultSummary, /Recent history \(8\/10\):/);
    assert.match(result.task.resultSummary, /\+2 more history item\(s\)/);
  });

  await runCase("rejects zero for /list -c because the history count must be positive", async () => {
    const agent = createDefaultAgent({
      codexAdapter: new ControlledCodexAdapter()
    });

    const result = await agent.receiveText(buildMessage("/list -c 0"));

    assert.equal(result.ok, false);
    assert.equal(result.task.status, "rejected");
    assert.match(result.task.resultSummary, /positive integer/i);
  });

  await runCase("lists available project folders under allowed roots", async () => {
    const tempRoot = createWorkspaceTempDir("codex-projects-");

    try {
      fs.mkdirSync(path.join(tempRoot, "AlphaApp"));
      fs.mkdirSync(path.join(tempRoot, "beta-app"));
      fs.mkdirSync(path.join(tempRoot, ".hidden-project"));
      fs.writeFileSync(path.join(tempRoot, "notes.txt"), "ignore me");

      const config = buildAgentConfig();
      config.security.allowedProjectRoots = [tempRoot];
      config.projects = {
        alpha_alias: {
          alias: "alpha_alias",
          projectName: "Alpha Alias",
          rootPath: path.join(tempRoot, "AlphaApp"),
          defaultFile: "README.md"
        }
      };

      const agent = createDefaultAgent({ config });
      const result = await agent.receiveText(buildMessage('/projects'));

      assert.equal(result.ok, true);
      assert.equal(result.task.response.actionId, "projects");
      assert.equal(result.task.response.totalProjectCount, 2);
      assert.equal(result.task.response.totalRootCount, 1);
      assert.deepEqual(
        result.task.response.roots[0].directories.map((entry) => entry.name),
        ["AlphaApp", "beta-app"]
      );
      assert.equal(result.task.response.configuredProjects[0].alias, "alpha_alias");
      assert.match(result.task.resultSummary, /Projects under/i);
      assert.match(result.task.resultSummary, /AlphaApp/);
      assert.match(result.task.resultSummary, /beta-app/);
      assert.match(result.task.resultSummary, /Example: \/create -n MyTask -w /i);
      assert.doesNotMatch(result.task.resultSummary, /Found \d+ project folder/i);
      assert.doesNotMatch(result.task.resultSummary, /AlphaApp @/);
      assert.doesNotMatch(result.task.resultSummary, /Shortcuts/i);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  await runCase("rejects project listing roots outside the allowed roots", async () => {
    const allowedRoot = createWorkspaceTempDir("codex-allowed-");
    const blockedRoot = createWorkspaceTempDir("codex-blocked-");

    try {
      const config = buildAgentConfig();
      config.security.allowedProjectRoots = [allowedRoot];
      config.projects = {};

      const agent = createDefaultAgent({ config });
      const result = await agent.receiveText(buildMessage(`/projects -w ${blockedRoot}`));

      assert.equal(result.ok, false);
      assert.equal(result.task.status, "rejected");
      assert.match(result.task.resultSummary, /allowed project roots/i);
    } finally {
      fs.rmSync(allowedRoot, { recursive: true, force: true });
      fs.rmSync(blockedRoot, { recursive: true, force: true });
    }
  });

  await runCase("browses project directories from the active session and reads files relative to the current folder", async () => {
    const workspaceRoot = createWorkspaceTempDir("codex-browse-");

    try {
      fs.mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "README.md"), "root readme\n");
      fs.writeFileSync(path.join(workspaceRoot, "docs", "guide.md"), "guide body\n");

      const config = buildAgentConfig();
      config.security.allowedProjectRoots = [workspaceRoot];
      config.projects = {};

      const agent = createDefaultAgent({ config });
      const createResult = await agent.receiveText(
        buildMessage('/create -n BrowseDemo -w ' + workspaceRoot)
      );

      assert.equal(createResult.ok, true);

      const lsRootResult = await agent.receiveText(buildMessage('/ls'));
      assert.equal(lsRootResult.ok, true);
      assert.equal(lsRootResult.task.response.actionId, 'ls');
      assert.match(lsRootResult.task.resultSummary, /Directory .* @ \//i);

      const docsEntry = lsRootResult.task.response.entries.find((entry) => entry.name === 'docs');
      assert.ok(docsEntry);

      const lsDocsResult = await agent.receiveText(buildMessage('/ls -p ' + docsEntry.index));
      assert.equal(lsDocsResult.ok, true);
      assert.equal(lsDocsResult.task.response.directory.relativePath, 'docs');
      assert.match(lsDocsResult.task.resultSummary, /guide.md/i);

      const readRelativeResult = await agent.receiveText(buildMessage('/read -f guide.md'));
      assert.equal(readRelativeResult.ok, true);
      assert.equal(readRelativeResult.task.response.relativePath, 'docs/guide.md');
      assert.equal(readRelativeResult.notifications.at(-1).attachment.fileName, 'guide.md');

      const guideEntry = lsDocsResult.task.response.entries.find((entry) => entry.name === 'guide.md');
      assert.ok(guideEntry);

      const readNumberResult = await agent.receiveText(buildMessage('/read -f ' + guideEntry.index));
      assert.equal(readNumberResult.ok, true);
      assert.equal(readNumberResult.task.response.relativePath, 'docs/guide.md');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  await runCase("supports /find results as numbered browse targets for /ls and /read", async () => {
    const workspaceRoot = createWorkspaceTempDir("codex-find-");

    try {
      fs.mkdirSync(path.join(workspaceRoot, "docs", "plans"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "docs", "plans", "guide.md"), "plan guide\n");
      fs.writeFileSync(path.join(workspaceRoot, "docs", "notes.txt"), "notes\n");

      const config = buildAgentConfig();
      config.security.allowedProjectRoots = [workspaceRoot];
      config.projects = {};

      const agent = createDefaultAgent({ config });
      await agent.receiveText(buildMessage('/create -n FindDemo -w ' + workspaceRoot));

      const findDirectoryResult = await agent.receiveText(buildMessage('/find -q plans'));
      assert.equal(findDirectoryResult.ok, true);
      assert.equal(findDirectoryResult.task.response.actionId, 'find');
      assert.match(findDirectoryResult.task.resultSummary, /Matches for "plans"/i);
      assert.equal(findDirectoryResult.task.response.entries[0].type, 'directory');

      const lsPlansResult = await agent.receiveText(buildMessage('/ls -p 1'));
      assert.equal(lsPlansResult.ok, true);
      assert.equal(lsPlansResult.task.response.directory.relativePath, 'docs/plans');

      const findFileResult = await agent.receiveText(buildMessage('/find -q guide'));
      assert.equal(findFileResult.ok, true);
      assert.equal(findFileResult.task.response.entries.length, 1);
      assert.equal(findFileResult.task.response.entries[0].relativePath, 'docs/plans/guide.md');

      const readNumberResult = await agent.receiveText(buildMessage('/read -f 1'));
      assert.equal(readNumberResult.ok, true);
      assert.equal(readNumberResult.task.response.relativePath, 'docs/plans/guide.md');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  await runCase("rejects /read numeric selections that point to directories", async () => {
    const workspaceRoot = createWorkspaceTempDir("codex-read-dir-");

    try {
      fs.mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "README.md"), "root readme\n");

      const config = buildAgentConfig();
      config.security.allowedProjectRoots = [workspaceRoot];
      config.projects = {};

      const agent = createDefaultAgent({ config });
      await agent.receiveText(buildMessage('/create -n RejectReadDir -w ' + workspaceRoot));

      const lsResult = await agent.receiveText(buildMessage('/ls'));
      const docsEntry = lsResult.task.response.entries.find((entry) => entry.name === 'docs');
      assert.ok(docsEntry);

      const readResult = await agent.receiveText(buildMessage('/read -f ' + docsEntry.index));
      assert.equal(readResult.ok, false);
      assert.equal(readResult.task.status, 'rejected');
      assert.match(readResult.task.resultSummary, /Use \/ls -p/i);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  await runCase("activates a local Codex conversation by /list number and routes plain text there", async () => {
    const adapter = new ControlledCodexAdapter({
      sendSessionStatus: 'ready',
      localSessions: [
        {
          codexSessionId: 'thread-123',
          title: 'Existing history conversation',
          updatedAt: '2026-03-24T00:00:00.000Z'
        }
      ]
    });
    const agent = createDefaultAgent({ codexAdapter: adapter });

    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const originalSessionId = createResult.task.response.session.sessionId;
    const listResult = await agent.receiveText(buildMessage('/list'));

    assert.equal(listResult.ok, true);
    assert.equal(listResult.task.response.selectionEntries.length, 2);
    assert.equal(listResult.task.response.selectionEntries[1].type, 'local');

    const activateResult = await agent.receiveText(buildMessage('/activate -n 2'));
    const activatedSessionId = activateResult.task.response.session.sessionId;

    assert.equal(activateResult.ok, true);
    assert.notEqual(activatedSessionId, originalSessionId);
    assert.equal(activateResult.task.response.session.codexThreadId, 'thread-123');

    const implicitSendResult = await agent.receiveText(buildMessage('Continue implementation'));

    assert.equal(implicitSendResult.ok, true);
    assert.equal(implicitSendResult.task.response.session.sessionId, activatedSessionId);
    assert.equal(adapter.sentPrompts.at(-1).sessionId, activatedSessionId);
    assert.equal(adapter.sentPrompts.at(-1).resumedThreadId, 'thread-123');
  });

  await runCase("activates a local Codex conversation by id with an explicit workspace and routes plain text there", async () => {
    const adapter = new ControlledCodexAdapter({
      sendSessionStatus: 'ready',
      localSessions: [
        {
          codexSessionId: 'thread-456',
          title: 'Continue yesterday task',
          updatedAt: '2026-03-24T00:00:00.000Z'
        }
      ]
    });
    const agent = createDefaultAgent({ codexAdapter: adapter });

    const activateResult = await agent.receiveText(
      buildMessage('/activate -n thread-456 -w demo')
    );
    const sessionId = activateResult.task.response.session.sessionId;

    assert.equal(activateResult.ok, true);
    assert.equal(activateResult.task.response.session.codexThreadId, 'thread-456');

    const implicitSendResult = await agent.receiveText(buildMessage("Continue yesterday's task"));

    assert.equal(implicitSendResult.ok, true);
    assert.equal(implicitSendResult.task.response.session.sessionId, sessionId);
    assert.equal(adapter.sentPrompts.at(-1).sessionId, sessionId);
    assert.equal(adapter.sentPrompts.at(-1).resumedThreadId, 'thread-456');
  });

  await runCase("sends directly to a local Codex conversation id using the active workspace context", async () => {
    const adapter = new ControlledCodexAdapter({
      sendSessionStatus: "ready",
      localSessions: [
        {
          codexSessionId: "thread-456",
          title: "Continue MCP work",
          updatedAt: "2026-03-24T00:00:00.000Z"
        }
      ]
    });
    const agent = createDefaultAgent({ codexAdapter: adapter });

    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const originalSessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage('/send -n thread-456 -m "Continue implementation"')
    );

    assert.equal(sendResult.ok, true);
    assert.notEqual(sendResult.task.response.session.sessionId, originalSessionId);
    assert.equal(sendResult.task.response.session.codexThreadId, 'thread-456');
    assert.equal(adapter.sentPrompts.at(-1).resumedThreadId, 'thread-456');

    const listResult = await agent.receiveText(buildMessage('/list'));
    assert.equal(listResult.task.response.activeSessionId, sendResult.task.response.session.sessionId);
    assert.equal(listResult.task.response.sessions.length, 2);
    assert.equal(listResult.task.response.localCodexSessions.length, 0);
  });

  await runCase("reuses an existing managed session when /send -n receives its codex conversation id", async () => {
    const adapter = new ControlledCodexAdapter({
      sendSessionStatus: "ready",
      localSessions: [
        {
          codexSessionId: "thread-123",
          title: "Existing managed conversation",
          updatedAt: "2026-03-24T00:00:00.000Z"
        }
      ]
    });
    const agent = createDefaultAgent({ codexAdapter: adapter });

    const activateResult = await agent.receiveText(
      buildMessage('/activate -n thread-123 -w demo')
    );
    const sessionId = activateResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage('/send -n thread-123 -m "Continue implementation"')
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.session.sessionId, sessionId);
    assert.equal(adapter.sentPrompts.at(-1).sessionId, sessionId);

    const listResult = await agent.receiveText(buildMessage('/list'));
    assert.equal(listResult.task.response.sessions.length, 1);
    assert.equal(listResult.task.response.localCodexSessions.length, 0);
  });

  await runCase("supports direct /send to a local Codex conversation id with an explicit workspace", async () => {
    const adapter = new ControlledCodexAdapter({
      sendSessionStatus: "ready",
      localSessions: [
        {
          codexSessionId: "thread-789",
          title: "Fresh local conversation",
          updatedAt: "2026-03-24T00:00:00.000Z"
        }
      ]
    });
    const agent = createDefaultAgent({ codexAdapter: adapter });

    const sendResult = await agent.receiveText(
      buildMessage('/send -n thread-789 -w demo -m "Start from explicit workspace"')
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.session.codexThreadId, 'thread-789');
    assert.equal(sendResult.task.response.session.projectRoot, process.cwd().replaceAll('\\', '/').replaceAll('/', path.sep));
    assert.equal(adapter.sentPrompts.at(-1).resumedThreadId, 'thread-789');
  });


  await runCase("routes plain text messages to the active session bound for the source", async () => {
    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultWaitIdleMs: 40,
        defaultWaitTimeoutMs: 240,
        defaultWaitPollMs: 10
      }),
      codexAdapter: new ControlledCodexAdapter({
        outputPlan: [
          { afterMs: 20, content: "Echo {prompt}" },
          { afterMs: 40, exit: true, nextStatus: "ready", preserveBinding: true }
        ]
      })
    });
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const implicitSendResult = await agent.receiveText(buildMessage('Continue implementing the API layer'));

    assert.equal(implicitSendResult.ok, true);
    assert.equal(implicitSendResult.task.response.actionId, "send");
    assert.equal(implicitSendResult.task.response.session.sessionId, sessionId);
    assert.equal(implicitSendResult.task.response.status, "settled");
    assert.match(implicitSendResult.task.response.assistantText, /Echo Continue implementing the API layer/);
    assert.match(implicitSendResult.task.resultSummary, /assistant output/i);

    const listResult = await agent.receiveText(buildMessage('/list'));
    assert.equal(listResult.task.response.activeSessionId, sessionId);
    assert.match(listResult.task.resultSummary, /\* 1\. session-/i);
  });
  await runCase("sends prompts, returns output cursors, and can screen only new output", async () => {
    const agent = createDefaultAgent();
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Refactor auth flow"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "settled");
    assert.match(sendResult.task.response.summary, /assistant reply completed/i);
    assert.equal(typeof sendResult.task.response.outputCursor, "number");
    assert.equal(typeof sendResult.task.response.latestCursor, "number");
    assert.match(sendResult.task.response.followUpScreenCommand, /\/screen -n .* -c \d+/i);
    assert.equal(sendResult.task.response.followUpWaitCommand, undefined);
    assert.doesNotMatch(sendResult.task.resultSummary, /screen: \/screen -n .* -c \d+/i);
    assert.ok(
      sendResult.notifications.some(
        (notification) =>
          notification.phase === "command.screen_hint" &&
          /screen: \/screen -n .* -c \d+/i.test(notification.message)
      )
    );
    assert.equal(
      sendResult.task.response.assistantText,
      "Simulated Codex response for DemoProject: prompt received."
    );
    assert.ok(sendResult.task.response.latestCursor > sendResult.task.response.outputCursor);

    const screenResult = await agent.receiveText(buildMessage(`/screen -n ${sessionId}`));
    assert.equal(screenResult.ok, true);
    assert.match(screenResult.task.response.rendered, /Refactor auth flow/);
    assert.match(screenResult.task.response.rendered, /Simulated Codex response/);

    const deltaScreenResult = await agent.receiveText(
      buildMessage(`/screen -n ${sessionId} -c ${sendResult.task.response.outputCursor}`)
    );
    assert.equal(deltaScreenResult.ok, true);
    assert.equal(deltaScreenResult.task.response.afterCursor, sendResult.task.response.outputCursor);
    assert.ok(deltaScreenResult.task.response.latestCursor >= sendResult.task.response.latestCursor);
    assert.match(deltaScreenResult.task.response.rendered, /Refactor auth flow/);
    assert.match(deltaScreenResult.task.response.rendered, /Simulated Codex response/);
    assert.doesNotMatch(deltaScreenResult.task.response.rendered, /Simulated Codex is ready/i);

    const readResult = await agent.receiveText(buildMessage(`/read -n ${sessionId} -f README.md`));
    assert.equal(readResult.ok, true);
    assert.equal(readResult.task.response.relativePath, "README.md");
    assert.equal(readResult.task.response.fileName, "README.md");
    assert.match(readResult.task.response.absolutePath, /README\.md$/i);
    assert.equal(readResult.task.response.attachment.kind, "document");
    assert.equal(readResult.notifications.at(-1).attachment.fileName, "README.md");
    assert.match(readResult.task.resultSummary, /attachment/i);
  });

  await runCase("returns full assistant text beyond the default visible screen window and sends screen guidance separately", async () => {
    const outputPlan = Array.from({ length: 6 }, (_, index) => ({
      afterMs: 10 + (index * 10),
      content: `Line ${index + 1}: {prompt}`
    }));
    outputPlan.push({ afterMs: 90, exit: true, nextStatus: "ready", preserveBinding: true });

    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultScreenLines: 3,
        defaultWaitTimeoutMs: 400,
        defaultWaitPollMs: 10,
        maxBufferedLines: 50
      }),
      codexAdapter: new ControlledCodexAdapter({ outputPlan })
    });
    const createResult = await agent.receiveText(buildMessage("/create -n DemoProject -w demo"));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Summarize repository"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "settled");
    assert.match(sendResult.task.response.assistantText, /Line 1: Summarize repository/);
    assert.match(sendResult.task.response.assistantText, /Line 6: Summarize repository/);
    assert.match(sendResult.task.response.rendered, /Line 4: Summarize repository/);
    assert.match(sendResult.task.response.rendered, /Line 6: Summarize repository/);
    assert.doesNotMatch(sendResult.task.response.rendered, /Line 1: Summarize repository/);
    assert.doesNotMatch(sendResult.task.resultSummary, /screen: \/screen -n .* -c \d+/i);
    assert.equal(sendResult.notifications.at(-2).phase, "command.screen_hint");
    assert.match(sendResult.notifications.at(-2).message, /screen: \/screen -n .* -c \d+/i);
    assert.equal(sendResult.notifications.at(-1).phase, "command.completed");
  });

  await runCase("labels timed-out send output as partial and keeps screen guidance in a separate notification", async () => {
    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultWaitIdleMs: 40,
        defaultWaitTimeoutMs: 160,
        defaultSendWaitTimeoutMs: 160,
        defaultWaitPollMs: 10
      }),
      codexAdapter: new ControlledCodexAdapter({
        outputPlan: [
          { afterMs: 5, content: "Planning {prompt}" }
        ]
      })
    });
    const createResult = await agent.receiveText(buildMessage("/create -n DemoProject -w demo"));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Long running task"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "timeout");
    assert.match(sendResult.task.response.assistantText, /Planning Long running task/);
    assert.match(sendResult.task.response.summary, /partial assistant output captured so far/i);
    assert.match(sendResult.task.resultSummary, /partial assistant output/i);
    assert.doesNotMatch(sendResult.task.resultSummary, /screen: \/screen -n .* -c \d+/i);
    assert.ok(
      sendResult.notifications.some(
        (notification) =>
          notification.phase === "command.screen_hint" &&
          /screen: \/screen -n .* -c \d+/i.test(notification.message)
      )
    );
  });
  await runCase("uses a longer internal wait timeout for /send than the explicit wait default", async () => {
    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultWaitIdleMs: 40,
        defaultWaitTimeoutMs: 80,
        defaultSendWaitTimeoutMs: 260,
        defaultWaitPollMs: 10
      }),
      codexAdapter: new ControlledCodexAdapter({
        outputPlan: [
          { afterMs: 30, content: "Planning {prompt}" },
          { afterMs: 140, content: "Completed {prompt}" },
          { afterMs: 180, exit: true, nextStatus: "ready", preserveBinding: true }
        ]
      })
    });
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage('/send -n ' + sessionId + ' -m "Implement feature"')
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "settled");
    assert.equal(sendResult.task.response.completionState, "assistant_answer_detected");
    assert.match(sendResult.task.response.assistantText, /Completed Implement feature/);
  });

  await runCase("auto-waits inside /send until delayed Codex output settles", async () => {
    const agent = createDefaultAgent({
      codexAdapter: new ControlledCodexAdapter({
        outputPlan: [
          { afterMs: 30, content: "Planning {prompt}" },
          { afterMs: 60, content: "Completed {prompt}" },
          { afterMs: 90, exit: true, nextStatus: "ready", preserveBinding: true }
        ]
      })
    });
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Build release notes"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "settled");
    assert.equal(sendResult.task.response.completionState, "assistant_answer_detected");
    assert.ok(sendResult.task.response.latestCursor > sendResult.task.response.outputCursor);
    assert.match(sendResult.task.response.rendered, /Planning Build release notes/);
    assert.match(sendResult.task.response.rendered, /Completed Build release notes/);
    assert.doesNotMatch(sendResult.task.response.rendered, /Controlled Codex session ready/i);
    assert.match(sendResult.task.response.assistantText, /Planning Build release notes/);
    assert.match(sendResult.task.response.assistantText, /Completed Build release notes/);
    assert.match(sendResult.task.resultSummary, /assistant output/i);
    assert.match(sendResult.task.resultSummary, /Planning Build release notes/);
    assert.doesNotMatch(sendResult.task.resultSummary, /screen: \/screen -n .* -c \d+/i);
    assert.equal(sendResult.notifications.at(-2).phase, "command.screen_hint");
    assert.match(sendResult.notifications.at(-2).message, /screen: \/screen -n .* -c \d+/i);
    assert.equal(sendResult.notifications.at(-1).phase, "command.completed");
    assert.match(sendResult.notifications.at(-1).message, /Completed Build release notes/);
  });


  await runCase("auto-waits for exec-json sessions to exit before reporting settled output", async () => {
    const agent = createDefaultAgent({
      codexAdapter: new ControlledCodexAdapter({
        outputPlan: [
          { afterMs: 20, content: "Planning {prompt}" },
          { afterMs: 120, exit: true, nextStatus: "ready", preserveBinding: true }
        ]
      })
    });
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Inspect repository"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "settled");
    assert.equal(sendResult.task.response.sessionStatus, "ready");
    assert.match(sendResult.task.response.assistantText, /Planning Inspect repository/);
  });
  await runCase("returns timeout state from /send when no complete assistant reply arrives", async () => {
    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultWaitIdleMs: 40,
        defaultWaitTimeoutMs: 120,
        defaultSendWaitTimeoutMs: 120,
        defaultWaitPollMs: 10
      }),
      codexAdapter: new ControlledCodexAdapter()
    });
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Do nothing"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(sendResult.task.response.status, "timeout");
    assert.equal(sendResult.task.response.completionState, "ui_only_activity");
    assert.equal(sendResult.task.response.assistantText, "");
    assert.equal(sendResult.task.response.outputCursor, 1);
    assert.equal(sendResult.task.response.latestCursor, 2);
    assert.equal(sendResult.task.response.sessionStatus, "running");
  });

  await runCase("rejects explicit /wait usage because /send now auto-waits", async () => {
    const agent = createDefaultAgent();
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const result = await agent.receiveText(buildMessage(`/wait -n ${sessionId}`));

    assert.equal(result.ok, false);
    assert.equal(result.task.status, "rejected");
    assert.match(result.task.resultSummary, /no longer needed/i);
  });

  await runCase("rejects invalid screen cursors", async () => {
    const agent = createDefaultAgent();
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const result = await agent.receiveText(buildMessage(`/screen -n ${sessionId} -c not-a-number`));

    assert.equal(result.ok, false);
    assert.equal(result.task.status, "rejected");
    assert.match(result.task.resultSummary, /non-negative integer/i);
  });

  await runCase("updates permission mode, can restore manual mode, and can kill a session", async () => {
    const adapter = new ControlledCodexAdapter({
      outputPlan: [
        { afterMs: 20, exit: true, nextStatus: "ready", preserveBinding: true }
      ]
    });
    const agent = createDefaultAgent({
      config: buildAgentConfig({
        defaultWaitIdleMs: 20,
        defaultWaitTimeoutMs: 120,
        defaultSendWaitTimeoutMs: 120,
        defaultWaitPollMs: 10
      }),
      codexAdapter: adapter
    });
    const createResult = await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));
    const sessionId = createResult.task.response.session.sessionId;

    const permissionResult = await agent.receiveText(
      buildMessage(`/enablePermission -n ${sessionId}`)
    );

    assert.equal(permissionResult.ok, true);
    assert.equal(permissionResult.task.response.session.permissionMode, "auto");

    const sendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Run with permission"`)
    );

    assert.equal(sendResult.ok, true);
    assert.equal(adapter.sentPrompts.at(-1).permissionMode, "auto");

    const disableResult = await agent.receiveText(
      buildMessage(`/disablePermission -n ${sessionId}`)
    );

    assert.equal(disableResult.ok, true);
    assert.equal(disableResult.task.response.session.permissionMode, "manual");

    const manualSendResult = await agent.receiveText(
      buildMessage(`/send -n ${sessionId} -m "Run with default mode"`)
    );

    assert.equal(manualSendResult.ok, true);
    assert.equal(adapter.sentPrompts.at(-1).permissionMode, "manual");

    const killResult = await agent.receiveText(buildMessage(`/kill -n ${sessionId}`));

    assert.equal(killResult.ok, true);
    assert.equal(killResult.task.response.session.status, "killed");
  });

  await runCase("rejects unauthorized sources before session execution", async () => {
    const agent = createDefaultAgent();
    const result = await agent.receiveText(
      buildMessage('/create -n DemoProject -w demo', 'intruder.wechat')
    );

    assert.equal(result.ok, false);
    assert.equal(result.task.status, "rejected");
    assert.match(result.task.resultSummary, /not allowed/i);
    assert.equal(result.task.steps.length, 0);
  });

  await runCase("supports watch-mode shutdown and cancellation with the configured password", async () => {
    const agent = createDefaultAgent();
    await agent.receiveText(buildMessage('/create -n DemoProject -w demo'));

    const armResult = await agent.receiveText(
      buildMessage('/shutdown -a CONFIRM_SHUTDOWN')
    );

    assert.equal(armResult.ok, true);
    assert.equal(armResult.task.response.plan.mode, "when_idle");
    assert.equal(armResult.task.response.plan.status, "ready");

    const cancelResult = await agent.receiveText(buildMessage('/cancel_shutdown'));

    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.task.response.plan.status, "idle");
  });

  await runCase("returns host probe details for /sys", async () => {
    const agent = createDefaultAgent();
    const result = await agent.receiveText(buildMessage('/sys'));

    assert.equal(result.ok, true);
    assert.equal(result.task.response.actionId, "sys");
    assert.ok(result.task.response.snapshot.activeSessions >= 0);
  });
}























