import assert from "node:assert/strict";

import { WeChatCommandParser } from "../src/message-parser.js";

export async function runMessageParserTests(runCase) {
  await runCase("parses create commands with short flags", () => {
    const parser = new WeChatCommandParser();
    const parsed = parser.parse('/create -n DemoProject -w demo');

    assert.equal(parsed.commandKey, "create");
    assert.deepEqual(parsed.args, {
      n: "DemoProject",
      w: "demo"
    });
  });

  await runCase("parses quoted send prompts and normalizes ping to sys", () => {
    const parser = new WeChatCommandParser();
    const parsed = parser.parse('/ping -n session-0001 -m "Refactor auth flow"');

    assert.equal(parsed.commandKey, "sys");
    assert.deepEqual(parsed.args, {
      n: "session-0001",
      m: "Refactor auth flow"
    });
  });

  await runCase("parses activate commands with target and workspace flags", () => {
    const parser = new WeChatCommandParser();
    const parsed = parser.parse("/activate -n thread-123 -w demo");

    assert.equal(parsed.commandKey, "activate");
    assert.deepEqual(parsed.args, {
      n: "thread-123",
      w: "demo"
    });
  });

  await runCase("parses disablePermission commands with target flags", () => {
    const parser = new WeChatCommandParser();
    const parsed = parser.parse("/disablePermission -n session-0001");

    assert.equal(parsed.commandKey, "disablepermission");
    assert.deepEqual(parsed.args, {
      n: "session-0001"
    });
  });

  await runCase("parses projects commands with workspace filters", () => {
    const parser = new WeChatCommandParser();
    const parsed = parser.parse('/projects -w F:\\project');

    assert.equal(parsed.commandKey, "projects");
    assert.deepEqual(parsed.args, {
      w: "F:\\project"
    });
  });

  await runCase("parses list commands with history expansion flags", () => {
    const parser = new WeChatCommandParser();
    const parsed = parser.parse("/list -a -c 12");

    assert.equal(parsed.commandKey, "list");
    assert.deepEqual(parsed.args, {
      a: true,
      c: "12"
    });
  });
  await runCase("parses help commands without flags", () => {
    const parser = new WeChatCommandParser();
    const parsed = parser.parse("/help");

    assert.equal(parsed.commandKey, "help");
    assert.deepEqual(parsed.args, {});
  });
  await runCase("rejects arguments that are not provided as flags", () => {
    const parser = new WeChatCommandParser();

    assert.throws(
      () => parser.parse('/create demo'),
      /Expected flag syntax/
    );
  });
}




