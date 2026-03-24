import crypto from "node:crypto";

import { AuthorizationError, ConfigurationError } from "./errors.js";
import { buildXml, parseXml } from "./xml-utils.js";

function toBuffer(value, encoding = "utf8") {
  return Buffer.from(String(value ?? ""), encoding);
}

function pkcs7Pad(buffer, blockSize = 32) {
  const remainder = buffer.length % blockSize;
  const amountToPad = remainder === 0 ? blockSize : blockSize - remainder;
  const padBuffer = Buffer.alloc(amountToPad, amountToPad);
  return Buffer.concat([buffer, padBuffer]);
}

function pkcs7Unpad(buffer, blockSize = 32) {
  if (buffer.length === 0) {
    throw new AuthorizationError("Encrypted payload is empty after decryption.", "wecom_payload_empty");
  }

  const amountToPad = buffer.at(-1);

  if (!amountToPad || amountToPad < 1 || amountToPad > blockSize) {
    throw new AuthorizationError(
      "Encrypted payload padding is invalid.",
      "wecom_padding_invalid",
      { amountToPad }
    );
  }

  return buffer.subarray(0, buffer.length - amountToPad);
}

function writeUint32BE(length) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(length, 0);
  return buffer;
}

function constantTimeEqual(left, right) {
  const leftBuffer = toBuffer(left);
  const rightBuffer = toBuffer(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export class WeComCrypto {
  constructor({ token, encodingAESKey, receiveId }) {
    if (!token) {
      throw new ConfigurationError("WeCom token is required.", "wecom_token_missing");
    }

    if (!encodingAESKey || encodingAESKey.length !== 43) {
      throw new ConfigurationError(
        "WeCom EncodingAESKey must be exactly 43 characters.",
        "wecom_encoding_aes_key_invalid"
      );
    }

    this.token = token;
    this.encodingAESKey = encodingAESKey;
    this.receiveId = receiveId ?? "";
    this.aesKey = Buffer.from(`${encodingAESKey}=`, "base64");
    this.iv = this.aesKey.subarray(0, 16);
  }

  computeSignature({ timestamp, nonce, encrypted }) {
    const sorted = [this.token, timestamp, nonce, encrypted]
      .map((item) => String(item ?? ""))
      .sort()
      .join("");

    return crypto.createHash("sha1").update(sorted).digest("hex");
  }

  verifySignature({ msgSignature, timestamp, nonce, encrypted }) {
    const expected = this.computeSignature({ timestamp, nonce, encrypted });

    if (!constantTimeEqual(expected, msgSignature)) {
      throw new AuthorizationError(
        "WeCom callback signature verification failed.",
        "wecom_signature_invalid"
      );
    }
  }

  verifyUrl({ msgSignature, timestamp, nonce, echostr }) {
    const { message, receiveId } = this.decryptPayload({
      msgSignature,
      timestamp,
      nonce,
      encrypted: decodeURIComponent(echostr)
    });

    this.#assertReceiveId(receiveId);
    return message;
  }

  decryptCallbackBody({ msgSignature, timestamp, nonce, rawBody }) {
    const envelope = parseXml(rawBody);
    const encrypted = envelope.Encrypt;

    if (!encrypted) {
      throw new AuthorizationError(
        "WeCom callback body is missing the Encrypt field.",
        "wecom_encrypt_missing"
      );
    }

    return this.decryptPayload({
      msgSignature,
      timestamp,
      nonce,
      encrypted
    });
  }

  decryptPayload({ msgSignature, timestamp, nonce, encrypted }) {
    this.verifySignature({ msgSignature, timestamp, nonce, encrypted });

    let decrypted;

    try {
      const decipher = crypto.createDecipheriv("aes-256-cbc", this.aesKey, this.iv);
      decipher.setAutoPadding(false);
      decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64")),
        decipher.final()
      ]);
    } catch (error) {
      throw new AuthorizationError(
        `WeCom encrypted payload could not be decrypted: ${error.message}`,
        "wecom_decrypt_failed"
      );
    }

    const plain = pkcs7Unpad(decrypted);
    const messageLength = plain.readUInt32BE(16);
    const messageStart = 20;
    const messageEnd = messageStart + messageLength;
    const message = plain.subarray(messageStart, messageEnd).toString("utf8");
    const receiveId = plain.subarray(messageEnd).toString("utf8");

    return {
      message,
      receiveId,
      encrypted
    };
  }

  encryptReply(message, { timestamp = this.createTimestamp(), nonce = this.createNonce() } = {}) {
    const random = crypto.randomBytes(16);
    const messageBuffer = toBuffer(message);
    const receiveIdBuffer = toBuffer(this.receiveId);
    const plainBuffer = Buffer.concat([
      random,
      writeUint32BE(messageBuffer.length),
      messageBuffer,
      receiveIdBuffer
    ]);

    const cipher = crypto.createCipheriv("aes-256-cbc", this.aesKey, this.iv);
    cipher.setAutoPadding(false);
    const encryptedBuffer = Buffer.concat([
      cipher.update(pkcs7Pad(plainBuffer)),
      cipher.final()
    ]);
    const encrypted = encryptedBuffer.toString("base64");
    const msgSignature = this.computeSignature({ timestamp, nonce, encrypted });

    return {
      encrypted,
      msgSignature,
      timestamp,
      nonce,
      xml: buildXml(
        {
          Encrypt: encrypted,
          MsgSignature: msgSignature,
          TimeStamp: timestamp,
          Nonce: nonce
        },
        {
          cdataKeys: ["Encrypt", "MsgSignature", "Nonce"]
        }
      )
    };
  }

  createTimestamp() {
    return Math.floor(Date.now() / 1000).toString();
  }

  createNonce(length = 16) {
    return crypto.randomBytes(length).toString("hex").slice(0, length);
  }

  #assertReceiveId(receiveId) {
    if (this.receiveId && receiveId !== this.receiveId) {
      throw new AuthorizationError(
        "WeCom callback receiveId did not match the configured corpId/suiteId.",
        "wecom_receive_id_invalid",
        { expected: this.receiveId, actual: receiveId }
      );
    }
  }
}
