import assert from "node:assert/strict";

import { analyzeCodexOutputLines } from "../src/output-analysis.js";

export async function runOutputAnalysisTests(runCase) {
  await runCase("classifies Codex UI-only activity separately from meaningful assistant output", async () => {
    const uiOnly = analyzeCodexOutputLines([
      { seq: 1, stream: "stdout", line: "gpt-5.4 xhigh", at: new Date().toISOString() },
      { seq: 2, stream: "stdout", line: "Press enter to continue", at: new Date().toISOString() }
    ]);

    assert.equal(uiOnly.uiOnlyActivity, true);
    assert.equal(uiOnly.meaningfulLineCount, 0);

    const assistant = analyzeCodexOutputLines([
      { seq: 3, stream: "stdout", line: "Updated README with deployment steps.", at: new Date().toISOString() }
    ]);

    assert.equal(assistant.uiOnlyActivity, false);
    assert.equal(assistant.meaningfulLineCount, 1);
    assert.equal(assistant.assistantText, "Updated README with deployment steps.");
  });

  await runCase("filters prompt echoes and Codex terminal chrome from assistant output", async () => {
    const uiOnly = analyzeCodexOutputLines([
      { seq: 1, stream: "stdout", line: "directory: F:/project/MCP", at: new Date().toISOString() },
      { seq: 2, stream: "stdout", line: "\u203a Please scan this project and summarize package.json scripts.", at: new Date().toISOString() },
      { seq: 3, stream: "stdout", line: ">_ OpenAI Codex (v0.116.0)", at: new Date().toISOString() },
      { seq: 4, stream: "stdout", line: "Tip: New Build faster with Codex.", at: new Date().toISOString() }
    ]);

    assert.equal(uiOnly.uiOnlyActivity, true);
    assert.equal(uiOnly.meaningfulLineCount, 0);
    assert.deepEqual(uiOnly.assistantLines, []);
    assert.deepEqual(
      uiOnly.lines.map((entry) => entry.kind),
      ["ui_status", "prompt_echo", "prompt_echo", "ui_status"]
    );
  });
  await runCase("treats substantive lines containing words like running as assistant output", async () => {
    const analysis = analyzeCodexOutputLines([
      { seq: 1, stream: "stdout", line: "Planning Long running task", at: new Date().toISOString() },
      { seq: 2, stream: "stdout", line: "Running Get-ChildItem -Force", at: new Date().toISOString() }
    ]);

    assert.equal(analysis.uiOnlyActivity, false);
    assert.equal(analysis.meaningfulLineCount, 2);
    assert.equal(analysis.assistantText, "Planning Long running task\nRunning Get-ChildItem -Force");
  });
}
