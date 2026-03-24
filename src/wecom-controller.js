import { buildWeComTextReply, parseXml } from "./xml-utils.js";

function now() {
  return Math.floor(Date.now() / 1000);
}

function truncate(text, maxLength = 512) {
  const value = String(text ?? "");
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function deriveCommandFromMessage(parsedMessage) {
  if (parsedMessage.MsgType === "text") {
    return parsedMessage.Content ?? null;
  }

  if (parsedMessage.MsgType === "event" && parsedMessage.Event === "click") {
    return parsedMessage.EventKey ?? null;
  }

  return null;
}

function deriveMessageId(parsedMessage) {
  return parsedMessage.MsgId ?? `${parsedMessage.FromUserName ?? "unknown"}-${parsedMessage.CreateTime ?? now()}`;
}

export class WeComCallbackController {
  constructor({
    agent,
    crypto,
    passiveReplyMode = "text",
    commandDispatchMode = "sync",
    logger = console
  } = {}) {
    this.agent = agent;
    this.crypto = crypto;
    this.passiveReplyMode = passiveReplyMode;
    this.commandDispatchMode = commandDispatchMode;
    this.logger = logger;
  }

  async handleValidationRequest({ query }) {
    const plaintext = this.crypto.verifyUrl({
      msgSignature: query.msg_signature,
      timestamp: query.timestamp,
      nonce: query.nonce,
      echostr: query.echostr
    });

    return {
      statusCode: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      },
      body: plaintext
    };
  }

  async handleCallbackRequest({ query, rawBody }) {
    const { message } = this.crypto.decryptCallbackBody({
      msgSignature: query.msg_signature,
      timestamp: query.timestamp,
      nonce: query.nonce,
      rawBody
    });
    const parsedMessage = parseXml(message);
    const commandText = deriveCommandFromMessage(parsedMessage);

    if (!commandText) {
      return this.#buildPassiveReply({
        parsedMessage,
        content: "暂不支持该类型消息，请发送文本命令。"
      });
    }

    const automationMessage = {
      sourceId: parsedMessage.FromUserName,
      messageId: deriveMessageId(parsedMessage),
      content: commandText
    };

    if (this.commandDispatchMode === "async") {
      this.#dispatchAsyncCommand(automationMessage);
      return this.#buildPassiveReply({
        parsedMessage,
        content: "命令已接收，开始执行。"
      });
    }

    const result = await this.agent.receiveText(automationMessage);
    const replyText = result.task?.resultSummary ?? (result.ok ? "命令已接收。" : "命令执行失败。");

    return this.#buildPassiveReply({
      parsedMessage,
      content: truncate(replyText)
    });
  }

  async handle({ method, query, rawBody }) {
    if (method === "GET") {
      return this.handleValidationRequest({ query });
    }

    if (method === "POST") {
      return this.handleCallbackRequest({ query, rawBody });
    }

    return {
      statusCode: 405,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      },
      body: "Method Not Allowed"
    };
  }

  #dispatchAsyncCommand(message) {
    queueMicrotask(() => {
      void this.agent.receiveText(message).catch((error) => {
        this.logger?.error?.("WeCom async command dispatch failed", {
          sourceId: message.sourceId,
          messageId: message.messageId,
          content: message.content,
          error: error?.stack ?? error?.message ?? error
        });
      });
    });
  }

  #buildPassiveReply({ parsedMessage, content }) {
    if (this.passiveReplyMode === "success") {
      return {
        statusCode: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        },
        body: "success"
      };
    }

    const replyXml = buildWeComTextReply({
      toUserName: parsedMessage.FromUserName,
      fromUserName: parsedMessage.ToUserName,
      createTime: now(),
      content
    });
    const encryptedReply = this.crypto.encryptReply(replyXml);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8"
      },
      body: encryptedReply.xml,
      plainReply: replyXml
    };
  }
}
