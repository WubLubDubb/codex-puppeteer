import assert from "node:assert/strict";

import { createPowerShellRunner, TelegramBotClient } from "../src/telegram-client.js";
import { TelegramBotNotifier } from "../src/telegram-notifier.js";

function createJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

export async function runTelegramClientTests(runCase) {
  await runCase("gets Telegram updates and sends Telegram messages", async () => {
    const calls = [];
    const client = new TelegramBotClient({
      botToken: "bot-token-demo",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/getUpdates")) {
          return createJsonResponse({
            ok: true,
            result: [{ update_id: 101, message: { message_id: 7, chat: { id: 42 }, text: "/list" } }]
          });
        }

        return createJsonResponse({
          ok: true,
          result: { message_id: 99 }
        });
      }
    });

    const updates = await client.getUpdates({ offset: 12, timeout: 5 });
    const message = await client.sendMessage({ chatId: "42", text: "hello telegram" });

    assert.equal(updates.length, 1);
    assert.equal(message.message_id, 99);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/getUpdates$/);
    assert.match(calls[1].url, /\/sendMessage$/);
    assert.match(calls[1].options.body, /hello telegram/);
  });

  await runCase("falls back to PowerShell transport when Windows fetch is blocked", async () => {
    const client = new TelegramBotClient({
      botToken: "bot-token-demo",
      fetchImpl: async () => {
        const error = new TypeError("fetch failed");
        error.cause = { code: "EACCES" };
        throw error;
      },
      transport: "auto",
      powershellRunner: async ({ url, body }) => ({
        ok: true,
        result: {
          via: "powershell",
          url,
          echoedText: body.text ?? null
        }
      })
    });

    const result = await client.sendMessage({ chatId: "42", text: "hello through powershell" });

    assert.equal(result.via, "powershell");
    assert.match(result.url, /\/sendMessage$/);
    assert.equal(result.echoedText, "hello through powershell");
  });

  await runCase("decodes UTF-8 Telegram updates from PowerShell transport", async () => {
    const payload = {
      ok: true,
      result: [
        {
          update_id: 102,
          message: {
            message_id: 8,
            chat: { id: 42 },
            text: "请先扫描当前项目，并总结 package.json 里的 scripts。"
          }
        }
      ]
    };
    const stdout = `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}\r\n`;
    const powershellRunner = createPowerShellRunner({
      execFileImpl: async () => ({ stdout })
    });
    const client = new TelegramBotClient({
      botToken: "bot-token-demo",
      transport: "powershell",
      powershellRunner
    });

    const updates = await client.getUpdates({ offset: 12, timeout: 5 });

    assert.equal(updates[0].message.text, "请先扫描当前项目，并总结 package.json 里的 scripts。");
  });

  await runCase("splits long Telegram notification content into multiple messages", async () => {
    const client = {
      sent: [],
      async sendMessage(payload) {
        this.sent.push(payload);
        return { message_id: this.sent.length };
      }
    };
    const notifier = new TelegramBotNotifier({
      client,
      maxMessageLength: 12
    });

    const record = await notifier.send({
      taskId: "task-tg-1",
      phase: "command.completed",
      sourceId: "42",
      message: "1234567890\nABCDEFGHIJ\nKLMNOP"
    });

    assert.ok(client.sent.length >= 2);
    assert.equal(record.chunkCount, client.sent.length);
    assert.equal(client.sent[0].chatId, "42");
  });
}
