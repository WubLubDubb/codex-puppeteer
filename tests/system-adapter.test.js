import assert from "node:assert/strict";

import { HostSystemAdapter } from "../src/system-adapter.js";

export async function runSystemAdapterTests(runCase) {
  await runCase("executes the real Windows shutdown command when immediate shutdown is requested", async () => {
    const commands = [];
    const adapter = new HostSystemAdapter({
      platform: "win32",
      commandRunner: async (command) => {
        commands.push(command);
        return { code: 0, stdout: "", stderr: "" };
      }
    });

    const result = await adapter.shutdownNow({ activeSessionCount: 2 });

    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, "shutdown");
    assert.deepEqual(commands[0].args, ["/s", "/t", "0"]);
    assert.equal(result.plan.status, "executed");
  });

  await runCase("executes armed shutdown only after all sessions exit in real mode", async () => {
    const commands = [];
    const adapter = new HostSystemAdapter({
      platform: "win32",
      commandRunner: async (command) => {
        commands.push(command);
        return { code: 0, stdout: "", stderr: "" };
      }
    });

    const armResult = await adapter.armShutdown({ activeSessionCount: 1 });
    assert.equal(armResult.plan.status, "armed");

    const stillWaiting = await adapter.executeArmedShutdownIfReady({ activeSessionCount: 1 });
    assert.equal(stillWaiting, null);

    const executed = await adapter.executeArmedShutdownIfReady({ activeSessionCount: 0 });
    assert.equal(commands.length, 1);
    assert.equal(executed.plan.status, "executed");
  });

  await runCase("sends the cancel command when a real shutdown was already executed", async () => {
    const commands = [];
    const adapter = new HostSystemAdapter({
      platform: "win32",
      commandRunner: async (command) => {
        commands.push(command);
        return { code: 0, stdout: "", stderr: "" };
      }
    });

    adapter.shutdownPlan = {
      mode: "immediate",
      status: "executed",
      armedAt: new Date().toISOString(),
      executedAt: new Date().toISOString(),
      command: null
    };

    const result = await adapter.cancelShutdown();

    assert.equal(commands.length, 1);
    assert.deepEqual(commands[0].args, ["/a"]);
    assert.equal(result.plan.status, "idle");
  });
}
