function deriveTelegramMessage(update) {
  return update?.message ?? update?.edited_message ?? null;
}

function deriveTelegramCallbackQuery(update) {
  return update?.callback_query ?? null;
}

function deriveMessageId(update, message) {
  return String(message?.message_id ?? update?.update_id ?? `${Date.now()}`);
}

function buildTelegramCallbackTransportContext(callbackQuery, message) {
  return {
    channel: "telegram",
    telegram: {
      kind: "callback_query",
      callbackQueryId: String(callbackQuery?.id ?? "").trim() || null,
      callbackChatId: String(message?.chat?.id ?? "").trim() || null,
      callbackMessageId: String(message?.message_id ?? "").trim() || null
    }
  };
}

export class TelegramUpdateController {
  constructor({
    agent,
    notifier = null,
    client = null,
    commandDispatchMode = "async",
    logger = console
  } = {}) {
    this.agent = agent;
    this.notifier = notifier;
    this.client = client;
    this.commandDispatchMode = commandDispatchMode;
    this.logger = logger;
  }

  async handleUpdate(update) {
    const callbackQuery = deriveTelegramCallbackQuery(update);

    if (callbackQuery) {
      return this.#handleCallbackQuery(update, callbackQuery);
    }

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

  async #handleCallbackQuery(update, callbackQuery) {
    const message = callbackQuery?.message ?? null;

    if (!message?.chat?.id || typeof callbackQuery?.data !== "string" || callbackQuery.data.trim() === "") {
      return {
        handled: false,
        reason: "callback_query_missing"
      };
    }

    const sourceId = String(message.chat.id);

    if (callbackQuery.from?.is_bot) {
      return {
        handled: false,
        reason: "bot_callback_query",
        sourceId
      };
    }

    await this.#answerCallbackQuery(callbackQuery.id);

    const automationMessage = {
      sourceId,
      messageId: String(callbackQuery.id ?? deriveMessageId(update, message)),
      content: callbackQuery.data.trim(),
      transportContext: buildTelegramCallbackTransportContext(callbackQuery, message)
    };

    if (this.commandDispatchMode === "async") {
      this.#dispatchAsyncCommand(automationMessage);
      return {
        handled: true,
        async: true,
        callbackQuery: true,
        automationMessage
      };
    }

    const result = await this.agent.receiveText(automationMessage);
    return {
      handled: true,
      async: false,
      callbackQuery: true,
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

  async #answerCallbackQuery(callbackQueryId) {
    if (!callbackQueryId || typeof this.client?.answerCallbackQuery !== "function") {
      return;
    }

    try {
      await this.client.answerCallbackQuery({ callbackQueryId });
    } catch (error) {
      this.logger?.warn?.("Telegram callback query acknowledgement failed", {
        callbackQueryId,
        error: error?.stack ?? error?.message ?? error
      });
    }
  }
}
