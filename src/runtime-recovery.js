import { cleanupProcessTree } from "./process-cleanup.js";

function now() {
  return new Date().toISOString();
}

export async function recoverRuntimeState({
  sessionRepository,
  taskRepository,
  cleanupProcess = cleanupProcessTree,
  notifier = null,
  logger = console,
  platform = process.platform,
  spawnFactory
} = {}) {
  const activeSessions = sessionRepository?.listActiveSessions?.() ?? [];
  const sessionResults = [];

  for (const session of activeSessions) {
    if (!session.pid) {
      sessionRepository.markRecovered(session.sessionId, {
        status: "recovered_missing",
        recovery: {
          reason: "pid_missing",
          strategy: "mark_interrupted"
        }
      });
      sessionResults.push({
        sessionId: session.sessionId,
        status: "recovered_missing",
        pid: null,
        reason: "pid_missing"
      });
      continue;
    }

    try {
      const cleanupResult = await cleanupProcess({
        pid: session.pid,
        platform,
        spawnFactory
      });
      const status = cleanupResult.cleaned ? "recovered_killed" : "recovered_missing";
      sessionRepository.markRecovered(session.sessionId, {
        status,
        recovery: {
          ...cleanupResult,
          pid: session.pid,
          strategy: cleanupResult.cleaned ? "cleanup" : "mark_missing"
        }
      });
      sessionResults.push({
        sessionId: session.sessionId,
        status,
        pid: session.pid,
        ...cleanupResult
      });
    } catch (error) {
      sessionRepository.markRecovered(session.sessionId, {
        status: "recovery_failed",
        recovery: {
          pid: session.pid,
          reason: error.message,
          strategy: "manual_review"
        }
      });
      sessionResults.push({
        sessionId: session.sessionId,
        status: "recovery_failed",
        pid: session.pid,
        reason: error.message
      });
    }
  }

  const interruptedTaskIds =
    typeof taskRepository?.markIncompleteTasksInterrupted === "function"
      ? taskRepository.markIncompleteTasksInterrupted({
          reason: "Runtime restarted while task execution was still in progress.",
          code: "runtime_restarted"
        })
      : [];

  const summary = {
    recoveredAt: now(),
    activeSessionCount: activeSessions.length,
    recoveredSessionCount: sessionResults.length,
    interruptedTaskCount: interruptedTaskIds.length,
    sessions: sessionResults,
    interruptedTaskIds
  };

  if (sessionResults.length > 0 || interruptedTaskIds.length > 0) {
    logger?.warn?.("Recovered runtime state after restart.", summary);

    await notifier?.send?.({
      taskId: null,
      phase: "runtime.recovered",
      sourceId: "system",
      message: `Recovered ${sessionResults.length} session(s) and interrupted ${interruptedTaskIds.length} unfinished task(s).`
    });
  }

  return summary;
}
