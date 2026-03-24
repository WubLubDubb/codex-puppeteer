import assert from "node:assert/strict";

import { WeComCrypto } from "../src/wecom-crypto.js";

const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

export async function runWeComCryptoTests(runCase) {
  await runCase("encrypts and decrypts WeCom payloads round-trip", () => {
    const crypto = new WeComCrypto({
      token: "token-123",
      encodingAESKey,
      receiveId: "corp-demo"
    });

    const encrypted = crypto.encryptReply("hello world", {
      timestamp: "1710000000",
      nonce: "nonce1234"
    });
    const decrypted = crypto.decryptPayload({
      msgSignature: encrypted.msgSignature,
      timestamp: encrypted.timestamp,
      nonce: encrypted.nonce,
      encrypted: encrypted.encrypted
    });

    assert.equal(decrypted.message, "hello world");
    assert.equal(decrypted.receiveId, "corp-demo");
  });

  await runCase("validates callback URL echostr values", () => {
    const crypto = new WeComCrypto({
      token: "token-123",
      encodingAESKey,
      receiveId: "corp-demo"
    });

    const encrypted = crypto.encryptReply("verify-me", {
      timestamp: "1710000001",
      nonce: "nonce5678"
    });
    const plaintext = crypto.verifyUrl({
      msgSignature: encrypted.msgSignature,
      timestamp: encrypted.timestamp,
      nonce: encrypted.nonce,
      echostr: encodeURIComponent(encrypted.encrypted)
    });

    assert.equal(plaintext, "verify-me");
  });

  await runCase("rejects invalid WeCom callback signatures", () => {
    const crypto = new WeComCrypto({
      token: "token-123",
      encodingAESKey,
      receiveId: "corp-demo"
    });
    const encrypted = crypto.encryptReply("hello", {
      timestamp: "1710000002",
      nonce: "nonce9012"
    });

    assert.throws(
      () =>
        crypto.decryptPayload({
          msgSignature: "invalid-signature",
          timestamp: encrypted.timestamp,
          nonce: encrypted.nonce,
          encrypted: encrypted.encrypted
        }),
      /signature/i
    );
  });
}
