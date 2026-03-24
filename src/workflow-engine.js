import { serializeError } from "./errors.js";

function now() {
  return new Date().toISOString();
}

export class WorkflowEngine {
  constructor({ repository, notifier, codexAdapter, systemAdapter }) {
    this.repository = repository;
    this.notifier = notifier;
    this.codexAdapter = codexAdapter;
    this.systemAdapter = systemAdapter;
  }

  async run({ taskId, message, parsedCommand, workflowDefinition, context }) {
    this.repository.setStatus(taskId, "running", {
      workflowId: workflowDefinition.id,
      context,
      resultSummary: null
    });

    this.repository.appendEvent(taskId, "task.started", {
      workflowId: workflowDefinition.id,
      commandKey: parsedCommand.commandKey
    });

    await this.notifier.send({
      taskId,
      phase: "task.started",
      sourceId: message.sourceId,
      message: `Task ${taskId} started for command ${parsedCommand.commandKey}.`
    });

    for (const step of workflowDefinition.steps) {
      this.repository.addStep(taskId, {
        stepId: step.id,
        actionId: step.actionId,
        adapter: step.adapter,
        status: "running",
        startedAt: now(),
        result: null,
        error: null
      });

      if (step.dangerous) {
        this.repository.appendEvent(taskId, "task.risky_action_pending", {
          actionId: step.actionId
        });

        await this.notifier.send({
          taskId,
          phase: "task.risky_action_pending",
          sourceId: message.sourceId,
          message: `Task ${taskId} is about to execute dangerous action ${step.actionId}.`
        });
      }

      try {
        const result = await this.#executeStep(step, { parsedCommand, context });
        this.repository.completeStep(taskId, step.id, result);
        this.repository.appendEvent(taskId, "step.completed", {
          stepId: step.id,
          actionId: step.actionId
        });

        if (result?.requiresManualAction) {
          this.repository.setStatus(taskId, "waiting_manual_action", {
            resultSummary: result.manualAction?.message ?? result.summary
          });
          this.repository.appendEvent(taskId, "task.manual_action_required", {
            stepId: step.id,
            actionId: step.actionId,
            manualAction: result.manualAction ?? null
          });

          await this.notifier.send({
            taskId,
            phase: "task.manual_action_required",
            sourceId: message.sourceId,
            message:
              result.manualAction?.message ??
              `Task ${taskId} is waiting for manual action at ${step.actionId}.`
          });

          return this.repository.getTask(taskId);
        }
      } catch (error) {
        const serialized = serializeError(error);
        this.repository.failStep(taskId, step.id, serialized);
        this.repository.addError(taskId, serialized);
        this.repository.setStatus(taskId, "failed", {
          resultSummary: `Workflow ${workflowDefinition.id} failed at ${step.actionId}.`
        });
        this.repository.appendEvent(taskId, "task.failed", {
          stepId: step.id,
          actionId: step.actionId,
          error: serialized
        });

        await this.notifier.send({
          taskId,
          phase: "task.failed",
          sourceId: message.sourceId,
          message: `Task ${taskId} failed at ${step.actionId}: ${serialized.message}`
        });

        return this.repository.getTask(taskId);
      }
    }

    this.repository.setStatus(taskId, "completed", {
      resultSummary: `Workflow ${workflowDefinition.id} completed successfully.`
    });
    this.repository.appendEvent(taskId, "task.completed", {
      workflowId: workflowDefinition.id
    });

    await this.notifier.send({
      taskId,
      phase: "task.completed",
      sourceId: message.sourceId,
      message: `Task ${taskId} completed successfully.`
    });

    return this.repository.getTask(taskId);
  }

  async #executeStep(step, { parsedCommand, context }) {
    const adapter = step.adapter === "codex" ? this.codexAdapter : this.systemAdapter;

    return adapter.execute(step.actionId, {
      params: parsedCommand.params,
      context,
      step
    });
  }
}
