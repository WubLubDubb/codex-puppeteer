import assert from "node:assert/strict";

import { InMemoryNotifier } from "../src/notifier.js";
import { InMemorySessionRepository } from "../src/session-repository.js";
import { InMemoryTaskRepository } from "../src/task-repository.js";
import { recoverRuntimeState } from "../src/runtime-recovery.js";

export async function runRuntimeRecoveryTests(runCase) {
  await runCase("recovers active sessions by cleaning up processes and interrupting unfinished tasks", async () => {
    const sessionRepository = new InMemorySessionRepository();
    sessionRepository.createSession({
      sessionId: "session-0001",
      projectName: "demo",
      projectRoot: process.cwd(),
      status: "starting"
    });
    sessionRepository.markRunning("session-0001", { pid: 1234 });

    const taskRepository = new InMemoryTaskRepository();
    const taskId = taskRepository.nextTaskId();
    taskRepository.createTask({
      taskId,
      message: {
        messageId: "message-1",
        sourceId: "owner.wechat",
        content: "/send -n session-0001 -m \"test\""
      }
    });
    taskRepository.addStep(taskId, {
      stepId: "step-1",
      actionId: "send",
      adapter: "codex",
      status: "running",
      startedAt: new Date().toISOString(),
      result: null,
      error: null
    });
    taskRepository.setStatus(taskId, "running");

    const notifier = new InMemoryNotifier();
    const cleaned = [];
    const summary = await recoverRuntimeState({
      sessionRepository,
      taskRepository,
      notifier,
      logger: { warn: () => {} },
      cleanupProcess: async ({ pid }) => {
        cleaned.push(pid);
        return {
          cleaned: true,
          reason: "killed",
          method: "taskkill"
        };
      }
    });

    assert.deepEqual(cleaned, [1234]);
    assert.equal(summary.recoveredSessionCount, 1);
    assert.equal(summary.interruptedTaskCount, 1);
    assert.equal(sessionRepository.getSession("session-0001").status, "recovered_killed");
    assert.equal(taskRepository.getTask(taskId).status, "interrupted");
    assert.equal(notifier.list()[0].phase, "runtime.recovered");
  });

  await runCase("marks active sessions without pid as missing during recovery", async () => {
    const sessionRepository = new InMemorySessionRepository();
    sessionRepository.createSession({
      sessionId: "session-0002",
      projectName: "demo",
      projectRoot: process.cwd(),
      status: "starting"
    });

    const summary = await recoverRuntimeState({
      sessionRepository,
      taskRepository: new InMemoryTaskRepository(),
      logger: { warn: () => {} },
      cleanupProcess: async () => {
        throw new Error("cleanup should not be called");
      }
    });

    assert.equal(summary.recoveredSessionCount, 1);
    assert.equal(sessionRepository.getSession("session-0002").status, "recovered_missing");
  });
}
