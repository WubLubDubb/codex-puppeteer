import { AdapterExecutionError } from "./errors.js";

function now() {
  return new Date().toISOString();
}

function defaultFormatter(notification) {
  return notification.message;
}

function normalizeDocumentAttachment(attachment) {
  if (attachment?.kind !== "document") {
    return null;
  }

  const filePath = String(attachment.filePath ?? "").trim();
  if (!filePath) {
    return null;
  }

  const fileName = String(attachment.fileName ?? "").trim() || null;
  return {
    kind: "document",
    filePath,
    fileName
  };
}

function normalizeEditDelivery(delivery) {
  if (delivery?.mode !== "edit-message") {
    return null;
  }

  const chatId = String(delivery.chatId ?? "").trim();
  const messageId = String(delivery.messageId ?? "").trim();

  if (!chatId || !messageId) {
    return null;
  }

  return {
    mode: "edit-message",
    chatId,
    messageId,
    fallbackToSend: delivery.fallbackToSend !== false
  };
}

function splitMessageContent(content, maxMessageLength) {
  const text = String(content ?? "");
  if (!text) {
    return [];
  }

  if (!Number.isInteger(maxMessageLength) || maxMessageLength <= 0 || text.length <= maxMessageLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxMessageLength) {
    let splitAt = remaining.lastIndexOf("\n", maxMessageLength);
    if (splitAt <= 0) {
      splitAt = maxMessageLength;
    }

    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

export class TelegramBotNotifier {
  constructor({
    client,
    defaultRecipient = null,
    formatter = defaultFormatter,
    maxMessageLength = 3500
  } = {}) {
    this.client = client;
    this.defaultRecipient = defaultRecipient;
    this.formatter = formatter;
    this.maxMessageLength = maxMessageLength;
    this.messages = [];
  }

  async send(notification) {
    const recipient = notification.sourceId && notification.sourceId !== "system"
      ? notification.sourceId
      : this.defaultRecipient;

    if (!recipient) {
      const skippedRecord = {
        ...notification,
        sentAt: now(),
        skipped: true,
        reason: "recipient_missing"
      };
      this.messages.push(skippedRecord);
      return structuredClone(skippedRecord);
    }

    const content = this.formatter(notification);
    const attachment = normalizeDocumentAttachment(notification.attachment);
    const replyMarkup =
      notification.replyMarkup && typeof notification.replyMarkup === "object"
        ? structuredClone(notification.replyMarkup)
        : null;
    const editDelivery = normalizeEditDelivery(notification.delivery);

    if (!content && !attachment) {
      throw new AdapterExecutionError(
        "Telegram notifier formatter returned an empty message.",
        "telegram_notifier_content_empty"
      );
    }

    if (attachment) {
      const remoteResult = await this.client.sendDocument({
        chatId: recipient,
        filePath: attachment.filePath,
        fileName: attachment.fileName,
        caption: content || undefined
      });

      const record = {
        ...notification,
        sentAt: now(),
        remoteResult,
        remoteResults: [
          {
            content: content || "",
            attachment,
            remoteResult
          }
        ],
        chunkCount: 1
      };
      this.messages.push(record);
      return structuredClone(record);
    }

    const messageChunks = splitMessageContent(content, this.maxMessageLength);

    if (editDelivery && messageChunks.length === 1 && typeof this.client?.editMessageText === "function") {
      try {
        const remoteResult = await this.client.editMessageText({
          chatId: editDelivery.chatId,
          messageId: editDelivery.messageId,
          text: messageChunks[0],
          replyMarkup
        });

        const record = {
          ...notification,
          sentAt: now(),
          remoteResult,
          remoteResults: [
            {
              content: messageChunks[0],
              remoteResult
            }
          ],
          chunkCount: 1
        };
        this.messages.push(record);
        return structuredClone(record);
      } catch (error) {
        if (!editDelivery.fallbackToSend) {
          throw error;
        }
      }
    }

    const remoteResults = [];

    for (const chunk of messageChunks) {
      const isLastChunk = remoteResults.length === messageChunks.length - 1;
      const remoteResult = await this.client.sendMessage({
        chatId: recipient,
        text: chunk,
        replyMarkup: isLastChunk ? replyMarkup : null
      });
      remoteResults.push({
        content: chunk,
        remoteResult
      });
    }

    const record = {
      ...notification,
      sentAt: now(),
      remoteResult: remoteResults[0]?.remoteResult ?? null,
      remoteResults,
      chunkCount: remoteResults.length
    };
    this.messages.push(record);
    return structuredClone(record);
  }

  list() {
    return structuredClone(this.messages);
  }
}

export { splitMessageContent as splitTelegramMessageContent };
