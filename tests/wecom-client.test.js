import assert from "node:assert/strict";

import { InMemoryNotifier, FanOutNotifier } from "../src/notifier.js";
import { WeComAccessTokenProvider, WeComClient } from "../src/wecom-client.js";
import { splitMessageContent, WeComAppNotifier } from "../src/wecom-notifier.js";

function createJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

export async function runWeComClientTests(runCase) {
  await runCase("caches WeCom access tokens until expiry", async () => {
    const calls = [];
    const provider = new WeComAccessTokenProvider({
      corpId: "corp-demo",
      corpSecret: "secret-demo",
      fetchImpl: async (url) => {
        calls.push(url);
        return createJsonResponse({
          errcode: 0,
          access_token: "token-abc",
          expires_in: 7200
        });
      }
    });

    const first = await provider.getAccessToken();
    const second = await provider.getAccessToken();

    assert.equal(first, "token-abc");
    assert.equal(second, "token-abc");
    assert.equal(calls.length, 1);
  });

  await runCase("sends WeCom text messages with the resolved access token", async () => {
    const fetchCalls = [];
    const provider = new WeComAccessTokenProvider({
      corpId: "corp-demo",
      corpSecret: "secret-demo",
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return createJsonResponse({
          errcode: 0,
          access_token: "token-xyz",
          expires_in: 7200
        });
      }
    });

    const client = new WeComClient({
      agentId: "1000002",
      tokenProvider: provider,
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return createJsonResponse({ errcode: 0, errmsg: "ok", msgid: "msg-1" });
      }
    });

    const result = await client.sendTextMessage({
      touser: "owner.wechat",
      content: "hello from tests"
    });

    assert.equal(result.errcode, 0);
    assert.equal(fetchCalls.length, 2);
    assert.match(fetchCalls[1].url, /message\/send/);
    assert.match(fetchCalls[1].url, /access_token=token-xyz/);
    assert.match(fetchCalls[1].options.body, /hello from tests/);
  });

  await runCase("splits long notification content into multiple WeCom messages", async () => {
    const chunks = splitMessageContent("line1\nline2\nline3\nline4", 10);
    assert.ok(chunks.length >= 2);

    const client = {
      sent: [],
      async sendTextMessage(payload) {
        this.sent.push(payload);
        return { errcode: 0, errmsg: "ok" };
      }
    };
    const notifier = new WeComAppNotifier({
      client,
      maxMessageLength: 12
    });

    const record = await notifier.send({
      taskId: "task-long",
      phase: "command.completed",
      sourceId: "owner.wechat",
      message: "1234567890\nABCDEFGHIJ\nKLMNOP"
    });

    assert.ok(client.sent.length >= 2);
    assert.equal(record.chunkCount, client.sent.length);
    assert.equal(client.sent[0].touser, "owner.wechat");
  });

  await runCase("fan-out notifier keeps local records and forwards to WeCom notifier", async () => {
    const client = {
      sent: [],
      async sendTextMessage(payload) {
        this.sent.push(payload);
        return { errcode: 0, errmsg: "ok" };
      }
    };
    const memoryNotifier = new InMemoryNotifier();
    const wecomNotifier = new WeComAppNotifier({ client });
    const notifier = new FanOutNotifier([memoryNotifier, wecomNotifier]);

    const record = await notifier.send({
      taskId: "task-1",
      phase: "command.completed",
      sourceId: "owner.wechat",
      message: "任务完成"
    });

    assert.equal(record.taskId, "task-1");
    assert.equal(memoryNotifier.list().length, 1);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].touser, "owner.wechat");
    assert.equal(client.sent[0].content, "任务完成");
  });

  await runCase("uses the default recipient for system notifications", async () => {
    const client = {
      sent: [],
      async sendTextMessage(payload) {
        this.sent.push(payload);
        return { errcode: 0, errmsg: "ok" };
      }
    };
    const notifier = new WeComAppNotifier({
      client,
      defaultRecipient: "owner.wechat"
    });

    await notifier.send({
      taskId: null,
      phase: "system.shutdown.ready",
      sourceId: "system",
      message: "系统将在任务完成后关机。"
    });

    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].touser, "owner.wechat");
    assert.equal(client.sent[0].content, "系统将在任务完成后关机。");
  });
}
