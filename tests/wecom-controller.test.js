import assert from "node:assert/strict";

import { WeComCallbackController } from "../src/wecom-controller.js";
import { WeComCrypto } from "../src/wecom-crypto.js";
import { buildXml, parseXml } from "../src/xml-utils.js";

const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

function buildEncryptedQuery(payload) {
  return {
    msg_signature: payload.msgSignature,
    timestamp: payload.timestamp,
    nonce: payload.nonce
  };
}

function buildEncryptedTextCallback(crypto, content, overrides = {}) {
  const plainCallback = buildXml(
    {
      ToUserName: overrides.toUserName ?? "corp-demo",
      FromUserName: overrides.fromUserName ?? "owner.wechat",
      CreateTime: overrides.createTime ?? 1710000200,
      MsgType: "text",
      Content: content,
      MsgId: overrides.msgId ?? 90001,
      AgentID: overrides.agentId ?? 1000002
    },
    {
      cdataKeys: ["ToUserName", "FromUserName", "MsgType", "Content"]
    }
  );

  return crypto.encryptReply(plainCallback, {
    timestamp: String(overrides.timestamp ?? 1710000200),
    nonce: overrides.nonce ?? "nonce-cb"
  });
}

export async function runWeComControllerTests(runCase) {
  await runCase("handles WeCom URL validation requests", async () => {
    const crypto = new WeComCrypto({
      token: "token-123",
      encodingAESKey,
      receiveId: "corp-demo"
    });
    const controller = new WeComCallbackController({
      agent: {
        async receiveText() {
          throw new Error("agent should not be called during validation");
        }
      },
      crypto
    });
    const encrypted = crypto.encryptReply("verify-echo", {
      timestamp: "1710000100",
      nonce: "nonce-echo"
    });

    const response = await controller.handleValidationRequest({
      query: {
        ...buildEncryptedQuery(encrypted),
        echostr: encodeURIComponent(encrypted.encrypted)
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "verify-echo");
  });

  await runCase("decrypts WeCom callbacks, dispatches agent commands, and returns encrypted replies", async () => {
    const crypto = new WeComCrypto({
      token: "token-123",
      encodingAESKey,
      receiveId: "corp-demo"
    });
    const calls = [];
    const controller = new WeComCallbackController({
      agent: {
        async receiveText(message) {
          calls.push(message);
          return {
            ok: true,
            task: {
              resultSummary: `Session session-0001 assistant output:\n已完成命令: ${message.content}`
            }
          };
        }
      },
      crypto
    });
    const encryptedCallback = buildEncryptedTextCallback(crypto, "/list");

    const response = await controller.handleCallbackRequest({
      query: buildEncryptedQuery(encryptedCallback),
      rawBody: encryptedCallback.xml
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceId, "owner.wechat");
    assert.equal(calls[0].content, "/list");
    assert.equal(response.statusCode, 200);

    const replyEnvelope = parseXml(response.body);
    const decryptedReply = crypto.decryptPayload({
      msgSignature: replyEnvelope.MsgSignature,
      timestamp: replyEnvelope.TimeStamp,
      nonce: replyEnvelope.Nonce,
      encrypted: replyEnvelope.Encrypt
    });
    const replyMessage = parseXml(decryptedReply.message);

    assert.equal(replyMessage.ToUserName, "owner.wechat");
    assert.equal(replyMessage.FromUserName, "corp-demo");
    assert.match(replyMessage.Content, /assistant output/);
    assert.match(replyMessage.Content, /已完成命令/);
  });

  await runCase("can acknowledge callbacks immediately in async dispatch mode", async () => {
    const crypto = new WeComCrypto({
      token: "token-123",
      encodingAESKey,
      receiveId: "corp-demo"
    });
    const calls = [];
    let resolveDispatch;
    const dispatched = new Promise((resolve) => {
      resolveDispatch = resolve;
    });
    const controller = new WeComCallbackController({
      agent: {
        async receiveText(message) {
          calls.push(message);
          resolveDispatch();
          return {
            ok: true,
            task: {
              resultSummary: `Session session-0001 assistant output:\n已完成命令: ${message.content}`
            }
          };
        }
      },
      crypto,
      passiveReplyMode: "success",
      commandDispatchMode: "async"
    });
    const encryptedCallback = buildEncryptedTextCallback(
      crypto,
      "/create -n DemoProject -w demo",
      {
        msgId: 90002,
        nonce: "nonce-async",
        timestamp: 1710000300
      }
    );

    const response = await controller.handleCallbackRequest({
      query: buildEncryptedQuery(encryptedCallback),
      rawBody: encryptedCallback.xml
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "success");

    await dispatched;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceId, "owner.wechat");
    assert.equal(calls[0].content, "/create -n DemoProject -w demo");
  });
}


