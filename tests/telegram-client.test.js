import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function createTempDocument(fileName = "README.md", content = "telegram attachment fixture") {
  const tempRoot = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, "telegram-client-"));
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, content);
  return {
    tempDir,
    filePath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
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

  await runCase("uploads Telegram documents through multipart form-data", async () => {
    const fixture = createTempDocument();

    try {
      const calls = [];
      const client = new TelegramBotClient({
        botToken: "bot-token-demo",
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          return createJsonResponse({
            ok: true,
            result: { message_id: 123 }
          });
        }
      });

      const result = await client.sendDocument({
        chatId: "42",
        filePath: fixture.filePath,
        caption: "Prepared README.md as an attachment."
      });

      assert.equal(result.message_id, 123);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/sendDocument$/);
      assert.equal(calls[0].options.body.get("chat_id"), "42");
      assert.equal(calls[0].options.body.get("caption"), "Prepared README.md as an attachment.");
      assert.equal(calls[0].options.body.get("document").name, "README.md");
    } finally {
      fixture.cleanup();
    }
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

  await runCase("falls back to PowerShell transport for Telegram document uploads", async () => {
    const fixture = createTempDocument();

    try {
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
            filePath: body.filePath,
            fileName: body.fileName,
            caption: body.caption
          }
        })
      });

      const result = await client.sendDocument({
        chatId: "42",
        filePath: fixture.filePath,
        caption: "Prepared README.md as an attachment."
      });

      assert.equal(result.via, "powershell");
      assert.match(result.url, /\/sendDocument$/);
      assert.equal(result.filePath, fixture.filePath);
      assert.equal(result.fileName, "README.md");
      assert.equal(result.caption, "Prepared README.md as an attachment.");
    } finally {
      fixture.cleanup();
    }
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

  await runCase("uses curl.exe for PowerShell document uploads on Windows hosts", async () => {
    const fixture = createTempDocument();

    try {
      let capturedScript = "";
      const stdout = `${Buffer.from(JSON.stringify({ ok: true, result: { message_id: 321 } }), "utf8").toString("base64")}\r\n`;
      const powershellRunner = createPowerShellRunner({
        execFileImpl: async (_command, args) => {
          capturedScript = args[3];
          return { stdout, stderr: "" };
        }
      });
      const client = new TelegramBotClient({
        botToken: "bot-token-demo",
        transport: "powershell",
        powershellRunner
      });

      const result = await client.sendDocument({
        chatId: "42",
        filePath: fixture.filePath,
        caption: "Prepared README.md as an attachment."
      });

      assert.equal(result.message_id, 321);
      assert.match(capturedScript, /Add-Type -AssemblyName System\.Net\.Http/);
      assert.match(capturedScript, /ReadAllBytes\(\$filePath\)/);
      assert.match(capturedScript, /MultipartFormDataContent/);
      assert.match(capturedScript, /text-multipart=/);
      assert.match(capturedScript, /ByteArrayContent/);
      assert.match(capturedScript, /Get-Command curl\.exe -All/);
      assert.match(capturedScript, /--form-string/);
      assert.match(capturedScript, /document=@/);
    } finally {
      fixture.cleanup();
    }
  });

  await runCase("surfaces PowerShell stderr when Telegram document upload returns no payload", async () => {
    const fixture = createTempDocument();

    try {
      const powershellRunner = createPowerShellRunner({
        execFileImpl: async () => ({
          stdout: "",
          stderr: "ConstrainedLanguage blocked document upload"
        })
      });
      const client = new TelegramBotClient({
        botToken: "bot-token-demo",
        transport: "powershell",
        powershellRunner
      });

      await assert.rejects(
        () => client.sendDocument({
          chatId: "42",
          filePath: fixture.filePath,
          caption: "Prepared README.md as an attachment."
        }),
        (error) => {
          assert.equal(error.code, "telegram_powershell_transport_failed");
          assert.match(error.message, /ConstrainedLanguage blocked document upload/);
          return true;
        }
      );
    } finally {
      fixture.cleanup();
    }
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

  await runCase("sends attachment notifications as Telegram documents", async () => {
    const fixture = createTempDocument();

    try {
      const client = {
        sentDocuments: [],
        async sendDocument(payload) {
          this.sentDocuments.push(payload);
          return { message_id: this.sentDocuments.length };
        }
      };
      const notifier = new TelegramBotNotifier({ client });

      const record = await notifier.send({
        taskId: "task-tg-2",
        phase: "command.completed",
        sourceId: "42",
        message: "Prepared README.md as an attachment.",
        attachment: {
          kind: "document",
          filePath: fixture.filePath,
          fileName: "README.md"
        }
      });

      assert.equal(client.sentDocuments.length, 1);
      assert.equal(client.sentDocuments[0].chatId, "42");
      assert.equal(client.sentDocuments[0].filePath, fixture.filePath);
      assert.equal(client.sentDocuments[0].fileName, "README.md");
      assert.equal(record.chunkCount, 1);
      assert.equal(record.remoteResults[0].attachment.fileName, "README.md");
    } finally {
      fixture.cleanup();
    }
  });
}
