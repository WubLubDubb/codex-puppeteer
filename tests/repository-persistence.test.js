import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { FileSessionRepository } from "../src/session-repository.js";
import { FileSourceBindingRepository } from "../src/source-binding-repository.js";
import { FileTaskRepository } from "../src/task-repository.js";

function createTempDir(prefix) {
  const tempDir = path.join(process.cwd(), "tmp", `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export async function runRepositoryPersistenceTests(runCase) {
  await runCase("persists sessions and buffered output across repository restarts", async () => {
    const tempDir = createTempDir("repo-session");
    const storageFilePath = path.join(tempDir, "sessions.json");

    const repository = new FileSessionRepository({
      storageFilePath,
      maxBufferedLines: 20
    });
    repository.createSession({
      sessionId: "session-0001",
      projectName: "demo",
      projectRoot: process.cwd(),
      status: "starting"
    });
    repository.markRunning("session-0001", { pid: 4321, driver: "exec-json" });
    repository.markReady("session-0001", {
      pid: null,
      driver: "exec-json",
      codexThreadId: "thread-123"
    });
    repository.appendOutput("session-0001", {
      stream: "stdout",
      content: "Assistant output line"
    });
    repository.createSession({
      sessionId: "session-0002",
      projectName: "attached",
      projectRoot: process.cwd(),
      driver: "exec-json",
      codexResumeMode: "last",
      status: "ready"
    });

    const reloaded = new FileSessionRepository({
      storageFilePath,
      maxBufferedLines: 20
    });
    const session = reloaded.getSession("session-0001");

    assert.equal(session.projectName, "demo");
    assert.equal(session.pid, null);
    assert.equal(session.driver, "exec-json");
    assert.equal(session.codexThreadId, "thread-123");
    assert.equal(reloaded.getLatestOutputSequence("session-0001"), 1);
    assert.equal(reloaded.getScreen("session-0001", { limit: 10 }).length, 1);
    assert.equal(reloaded.getSession("session-0002").codexResumeMode, "last");
    assert.equal(reloaded.nextSessionId(), "session-0003");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await runCase("persists active source bindings across repository restarts", async () => {
    const tempDir = createTempDir("repo-binding");
    const storageFilePath = path.join(tempDir, "source-bindings.json");

    const repository = new FileSourceBindingRepository({ storageFilePath });
    repository.setBinding({
      sourceId: "owner.wechat",
      sessionId: "session-0001"
    });

    const reloaded = new FileSourceBindingRepository({ storageFilePath });
    const binding = reloaded.getBinding("owner.wechat");
    assert.equal(binding.sessionId, "session-0001");

    reloaded.clearBindingsForSession("session-0001");
    const cleared = new FileSourceBindingRepository({ storageFilePath });
    assert.equal(cleared.getBinding("owner.wechat"), null);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await runCase("persists tasks and interrupted recovery state across repository restarts", async () => {
    const tempDir = createTempDir("repo-task");
    const storageFilePath = path.join(tempDir, "tasks.json");

    const repository = new FileTaskRepository({ storageFilePath });
    const taskId = repository.nextTaskId();
    repository.createTask({
      taskId,
      message: {
        messageId: "message-1",
        sourceId: "owner.wechat",
        content: "/send -n session-0001 -m \"test\""
      }
    });
    repository.setParsedCommand(taskId, {
      commandKey: "send",
      args: {
        n: "session-0001",
        m: "test"
      }
    });
    repository.addStep(taskId, {
      stepId: "step-1",
      actionId: "send",
      adapter: "codex",
      status: "running",
      startedAt: new Date().toISOString(),
      result: null,
      error: null
    });
    repository.setStatus(taskId, "running");

    const reloaded = new FileTaskRepository({ storageFilePath });
    assert.equal(reloaded.getTask(taskId).status, "running");

    reloaded.markIncompleteTasksInterrupted();

    const interruptedReload = new FileTaskRepository({ storageFilePath });
    const task = interruptedReload.getTask(taskId);
    assert.equal(task.status, "interrupted");
    assert.match(task.resultSummary, /Runtime restarted/i);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}
