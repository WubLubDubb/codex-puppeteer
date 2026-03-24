import { AdapterExecutionError } from "./errors.js";

function now() {
  return new Date().toISOString();
}

function defaultFormatter(notification) {
  return notification.message;
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

export class WeComAppNotifier {
  constructor({
    client,
    defaultRecipient = null,
    formatter = defaultFormatter,
    maxMessageLength = 1200
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

    if (!content) {
      throw new AdapterExecutionError(
        "WeCom notifier formatter returned an empty message.",
        "wecom_notifier_content_empty"
      );
    }

    const messageChunks = splitMessageContent(content, this.maxMessageLength);
    const remoteResults = [];

    for (const chunk of messageChunks) {
      const remoteResult = await this.client.sendTextMessage({
        touser: recipient,
        content: chunk
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

export { splitMessageContent };
