import assert from "node:assert/strict";

import { InMemoryNotifier } from "../src/notifier.js";
import { TelegramUpdateController } from "../src/telegram-controller.js";

function buildTextUpdate(text, chatId = 42) {
  return {
    update_id: 1001,
    message: {
      message_id: 77,
      chat: { id: chatId },
      from: { id: chatId, is_bot: false },
      text
    }
  };
}

export async function runTelegramControllerTests(runCase) {
  await runCase("routes Telegram text messages into the automation agent", async () => {
    const received = [];
    const agent = {
      async receiveText(message) {
        received.push(message);
        return {
          ok: true,
          task: {
            status: "completed",
            resultSummary: "done"
          }
        };
      }
    };
    const controller = new TelegramUpdateController({
      agent,
      commandDispatchMode: "sync"
    });

    const result = await controller.handleUpdate(buildTextUpdate("/list"));

    assert.equal(result.handled, true);
    assert.equal(result.async, false);
    assert.equal(received.length, 1);
    assert.equal(received[0].sourceId, "42");
    assert.equal(received[0].content, "/list");
    assert.equal(received[0].messageId, "77");
  });

  await runCase("rejects unsupported Telegram message types with a chat reply", async () => {
    const notifier = new InMemoryNotifier();
    const controller = new TelegramUpdateController({
      agent: {
        async receiveText() {
          throw new Error("should not be called");
        }
      },
      notifier,
      commandDispatchMode: "sync"
    });

    const result = await controller.handleUpdate({
      update_id: 1002,
      message: {
        message_id: 88,
        chat: { id: 42 },
        from: { id: 42, is_bot: false },
        photo: [{ file_id: "abc" }]
      }
    });

    assert.equal(result.handled, false);
    assert.equal(result.reason, "unsupported_message_type");
    assert.equal(notifier.list().length, 1);
    assert.equal(notifier.list()[0].phase, "command.unsupported");
    assert.equal(notifier.list()[0].sourceId, "42");
    assert.ok(String(notifier.list()[0].message ?? "").length > 0);
  });
}
