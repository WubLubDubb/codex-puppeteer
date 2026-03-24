import { randomUUID } from "node:crypto";

import { loadJsonFile, writeJsonFileAtomic } from "./storage-utils.js";

function now() {
  return new Date().toISOString();
}

function normalizeLoadedTask(task) {
  return {
    taskId: task.taskId,
    messageId: task.messageId ?? null,
    sourceId: task.sourceId ?? null,
    rawCommand: task.rawCommand ?? "",
    status: task.status ?? "received",
    commandKey: task.commandKey ?? null,
    args: structuredClone(task.args ?? {}),
    params: structuredClone(task.params ?? {}),
    context: task.context ?? null,
    response: task.response ?? null,
    steps: Array.isArray(task.steps) ? structuredClone(task.steps) : [],
    events: Array.isArray(task.events) ? structuredClone(task.events) : [],
    errors: Array.isArray(task.errors) ? structuredClone(task.errors) : [],
    resultSummary: task.resultSummary ?? null,
    createdAt: task.createdAt ?? now(),
    updatedAt: task.updatedAt ?? task.createdAt ?? now(),
    finishedAt: task.finishedAt ?? null
  };
}

function isOpenTaskStatus(status) {
  return status === "received" || status === "running";
}

export class InMemoryTaskRepository {
  constructor() {
    this.tasks = new Map();
  }

  nextTaskId() {
    return `task-${randomUUID()}`;
  }

  createTask({ taskId, message }) {
    const timestamp = now();
    const task = {
      taskId,
      messageId: message.messageId,
      sourceId: message.sourceId,
      rawCommand: message.content,
      status: "received",
      commandKey: null,
      args: {},
      params: {},
      context: null,
      response: null,
      steps: [],
      events: [
        {
          phase: "command.received",
          at: timestamp,
          detail: { sourceId: message.sourceId }
        }
      ],
      errors: [],
      resultSummary: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null
    };

    this.tasks.set(taskId, task);
    this._afterChange();
    return this.getTask(taskId);
  }

  setParsedCommand(taskId, parsedCommand) {
    this.#mutate(taskId, (task) => {
      task.commandKey = parsedCommand.commandKey;
      task.args = structuredClone(parsedCommand.args);
      task.params = structuredClone(parsedCommand.args);
    });
  }

  setContext(taskId, context) {
    this.#mutate(taskId, (task) => {
      task.context = structuredClone(context);
    });
  }

  setResponse(taskId, response) {
    this.#mutate(taskId, (task) => {
      task.response = structuredClone(response);
    });
  }

  addStep(taskId, stepRecord) {
    this.#mutate(taskId, (task) => {
      task.steps.push(structuredClone(stepRecord));
    });
  }

  completeStep(taskId, stepId, result) {
    this.#mutate(taskId, (task) => {
      const step = task.steps.find((entry) => entry.stepId === stepId);
      if (!step) {
        throw new Error(`Unknown step "${stepId}" for task "${taskId}".`);
      }

      step.status = "completed";
      step.finishedAt = now();
      step.result = structuredClone(result);
    });
  }

  failStep(taskId, stepId, error) {
    this.#mutate(taskId, (task) => {
      const step = task.steps.find((entry) => entry.stepId === stepId);
      if (!step) {
        throw new Error(`Unknown step "${stepId}" for task "${taskId}".`);
      }

      step.status = "failed";
      step.finishedAt = now();
      step.error = structuredClone(error);
    });
  }

  appendEvent(taskId, phase, detail = {}) {
    this.#mutate(taskId, (task) => {
      task.events.push({
        phase,
        at: now(),
        detail: structuredClone(detail)
      });
    });
  }

  addError(taskId, error) {
    this.#mutate(taskId, (task) => {
      task.errors.push(structuredClone(error));
    });
  }

  setStatus(taskId, status, extra = {}) {
    this.#mutate(taskId, (task) => {
      Object.assign(task, structuredClone(extra), { status });

      if (["completed", "failed", "rejected", "interrupted"].includes(status)) {
        task.finishedAt = now();
      }
    });
  }

  markIncompleteTasksInterrupted({
    reason = "Runtime restarted while task execution was still in progress.",
    code = "runtime_restarted"
  } = {}) {
    const interruptedTaskIds = [];

    for (const task of this.tasks.values()) {
      if (!isOpenTaskStatus(task.status)) {
        continue;
      }

      const timestamp = now();
      task.status = "interrupted";
      task.resultSummary = reason;
      task.finishedAt = timestamp;
      task.updatedAt = timestamp;
      task.errors.push({
        name: "AutomationError",
        code,
        message: reason,
        details: {
          recoveredAt: timestamp
        }
      });
      task.events.push({
        phase: "task.interrupted_on_recovery",
        at: timestamp,
        detail: {
          code,
          reason
        }
      });

      for (const step of task.steps) {
        if (step.status === "running") {
          step.status = "failed";
          step.finishedAt = timestamp;
          step.error = {
            name: "AutomationError",
            code,
            message: reason,
            details: {
              recoveredAt: timestamp
            }
          };
        }
      }

      interruptedTaskIds.push(task.taskId);
    }

    if (interruptedTaskIds.length > 0) {
      this._afterChange();
    }

    return interruptedTaskIds;
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }

  listTasks() {
    return Array.from(this.tasks.values(), (task) => structuredClone(task));
  }

  getStorageSnapshot() {
    return {
      tasks: this.listTasks()
    };
  }

  _importState(state) {
    this.tasks = new Map();

    for (const task of Array.isArray(state?.tasks) ? state.tasks : []) {
      const normalized = normalizeLoadedTask(task);
      this.tasks.set(normalized.taskId, normalized);
    }
  }

  _afterChange() {}

  #mutate(taskId, updater) {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Unknown task "${taskId}".`);
    }

    updater(task);
    task.updatedAt = now();
    this._afterChange();
  }
}

export class FileTaskRepository extends InMemoryTaskRepository {
  constructor({ storageFilePath } = {}) {
    super();
    this.storageFilePath = storageFilePath ?? null;

    if (this.storageFilePath) {
      const state = loadJsonFile(this.storageFilePath, null);
      if (state) {
        this._importState(state);
      } else {
        this._afterChange();
      }
    }
  }

  _afterChange() {
    if (!this.storageFilePath) {
      return;
    }

    writeJsonFileAtomic(this.storageFilePath, this.getStorageSnapshot());
  }
}

