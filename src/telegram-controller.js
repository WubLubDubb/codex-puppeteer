function deriveTelegramMessage(update) {
  return update?.message ?? update?.edited_message ?? null;
}

function deriveMessageId(update, message) {
  return String(message?.message_id ?? update?.update_id ?? `${Date.now()}`);
}

export class TelegramUpdateController {
  constructor({
    agent,
    notifier = null,
    commandDispatchMode = "async",
    logger = console
  } = {}) {
    this.agent = agent;
    this.notifier = notifier;
    this.commandDispatchMode = commandDispatchMode;
    this.logger = logger;
  }

  async handleUpdate(update) {
    const message = deriveTelegramMessage(update);

    if (!message?.chat?.id) {
      return {
        handled: false,
        reason: "message_missing"
      };
    }

    const sourceId = String(message.chat.id);

    if (message.from?.is_bot) {
      return {
        handled: false,
        reason: "bot_message",
        sourceId
      };
    }

    if (typeof message.text !== "string" || message.text.trim() === "") {
      await this.notifier?.send?.({
        taskId: null,
        phase: "command.unsupported",
        sourceId,
        message: "暂不支持该类型消息，请发送文本命令。"
      });
      return {
        handled: false,
        reason: "unsupported_message_type",
        sourceId
      };
    }

    const automationMessage = {
      sourceId,
      messageId: deriveMessageId(update, message),
      content: message.text
    };

    if (this.commandDispatchMode === "async") {
      this.#dispatchAsyncCommand(automationMessage);
      return {
        handled: true,
        async: true,
        automationMessage
      };
    }

    const result = await this.agent.receiveText(automationMessage);
    return {
      handled: true,
      async: false,
      automationMessage,
      result
    };
  }

  #dispatchAsyncCommand(message) {
    queueMicrotask(() => {
      void this.agent.receiveText(message).catch((error) => {
        this.logger?.error?.("Telegram async command dispatch failed", {
          sourceId: message.sourceId,
          messageId: message.messageId,
          content: message.content,
          error: error?.stack ?? error?.message ?? error
        });
      });
    });
  }
}
