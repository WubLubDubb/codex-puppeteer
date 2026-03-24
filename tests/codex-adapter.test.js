import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  createPreferredCodexAdapter,
  ExecCodexAdapter,
  PtyCodexAdapter,
  SimulatedCodexAdapter,
  SubprocessCodexAdapter
} from "../src/codex-adapter.js";

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = {
      writes: [],
      write: (chunk) => {
        this.stdin.writes.push(chunk);
        return true;
      }
    };
    this.pid = 4321;
  }

  kill() {
    this.emit("exit", 0, null);
    return true;
  }
}

class TerminalRequiredChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = {
      write: () => true
    };
    this.pid = 9876;

    setImmediate(() => {
      this.stderr.write("Error:\nstdin is not a terminal\n");
      this.emit("exit", 1, null);
    });
  }

  kill() {
    this.emit("exit", 0, null);
    return true;
  }
}

class FakePtyProcess {
  constructor() {
    this.pid = 2468;
    this.writes = [];
    this.dataListeners = new Set();
    this.exitListeners = new Set();
    this.killError = null;
    this.killCalls = 0;
    this.socketDestroyed = false;
    this.socketListenersRemoved = false;
    this.inSocketDestroyed = false;
    this.outSocketDestroyed = false;
    this.conoutDisposed = false;
    this._socket = {
      removeAllListeners: () => {
        this.socketListenersRemoved = true;
      },
      destroy: () => {
        this.socketDestroyed = true;
      }
    };
    this._agent = {
      _inSocket: {
        destroy: () => {
          this.inSocketDestroyed = true;
        }
      },
      _outSocket: {
        destroy: () => {
          this.outSocketDestroyed = true;
        }
      },
      _conoutSocketWorker: {
        dispose: () => {
          this.conoutDisposed = true;
        }
      }
    };
  }

  onData(listener) {
    this.dataListeners.add(listener);
    return {
      dispose: () => this.dataListeners.delete(listener)
    };
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    return {
      dispose: () => this.exitListeners.delete(listener)
    };
  }

  write(data) {
    this.writes.push(data);
  }

  kill() {
    this.killCalls += 1;
    if (this.killError) {
      throw this.killError;
    }
    this.emitExit({ exitCode: 0, signal: 0 });
  }

  emitData(data) {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event) {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

export async function runCodexAdapterTests(runCase) {
  await runCase("uses the simulated adapter when CODEX_PUPPETEER_CODEX_MODE=simulated", async () => {
    const adapter = createPreferredCodexAdapter({
      env: { CODEX_PUPPETEER_CODEX_MODE: "simulated" },
      platform: "win32"
    });

    assert.ok(adapter instanceof SimulatedCodexAdapter);
  });

  await runCase("reads local Codex conversation index for /list history support", async () => {
    const tempRoot = path.join(process.cwd(), "tmp");
    fs.mkdirSync(tempRoot, { recursive: true });
    const codexHome = fs.mkdtempSync(path.join(tempRoot, "codex-home-"));

    try {
      fs.writeFileSync(
        path.join(codexHome, "session_index.jsonl"),
        [
          JSON.stringify({
            id: "thread-2",
            thread_name: "Second thread",
            updated_at: "2026-03-23T10:00:00.000Z"
          }),
          JSON.stringify({
            id: "thread-1",
            thread_name: "First thread",
            updated_at: "2026-03-23T11:00:00.000Z"
          }),
          JSON.stringify({
            id: "thread-1",
            thread_name: "First thread older",
            updated_at: "2026-03-23T09:00:00.000Z"
          }),
          JSON.stringify({
            id: "thread-3",
            thread_name: "No timestamp thread",
            updated_at: "not-a-real-timestamp"
          })
        ].join("\n")
      );

      const adapter = new ExecCodexAdapter({
        command: "codex",
        env: { CODEX_PUPPETEER_CODEX_HOME: codexHome },
        platform: "win32",
        spawnFactory: () => {
          throw new Error("spawnFactory should not be used while listing local sessions");
        }
      });

      const result = await adapter.listLocalSessions();

      assert.equal(result.totalCount, 3);
      assert.equal(result.conversations[0].codexSessionId, "thread-1");
      assert.equal(result.conversations[0].title, "First thread");
      assert.equal(result.conversations[1].codexSessionId, "thread-2");
      assert.equal(result.conversations[2].codexSessionId, "thread-3");
      assert.equal(result.conversations[2].updatedAt, null);
      assert.equal(result.sessionIndexPath, path.join(codexHome, "session_index.jsonl"));
    } finally {
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  });

  await runCase("uses the exec adapter when real mode is requested", async () => {
    const adapter = createPreferredCodexAdapter({
      env: { CODEX_PUPPETEER_CODEX_MODE: "real", CODEX_CLI: "codex" },
      platform: "win32"
    });

    assert.ok(adapter instanceof ExecCodexAdapter);
  });

  await runCase("can still select the PTY adapter explicitly", async () => {
    const adapter = createPreferredCodexAdapter({
      env: {
        CODEX_PUPPETEER_CODEX_MODE: "real",
        CODEX_CLI: "codex",
        CODEX_PUPPETEER_TERMINAL_DRIVER: "pty"
      },
      platform: "win32"
    });

    assert.ok(adapter instanceof PtyCodexAdapter);
  });

  await runCase("can still select the pipe adapter explicitly", async () => {
    const adapter = createPreferredCodexAdapter({
      env: {
        CODEX_PUPPETEER_CODEX_MODE: "real",
        CODEX_CLI: "codex",
        CODEX_PUPPETEER_TERMINAL_DRIVER: "pipe"
      },
      platform: "win32"
    });

    assert.ok(adapter instanceof SubprocessCodexAdapter);
  });


  await runCase("spawns codex exec and resume runs while capturing JSON assistant output", async () => {
    const invocations = [];
    const outputs = [];
    const exits = [];
    const metadata = [];
    const children = [];

    const adapter = new ExecCodexAdapter({
      command: "codex",
      env: {},
      platform: "win32",
      spawnFactory: (command, args, options) => {
        invocations.push({ command, args, options });
        const child = new FakeChildProcess();
        children.push(child);
        return child;
      }
    });

    const session = {
      sessionId: "session-0004",
      projectName: "demo",
      projectRoot: "F:/Project/codex-puppeteer",
      launchMode: "background",
      codexThreadId: null
    };

    const launch = await adapter.createSession({ session });
    assert.equal(launch.driver, "exec-json");
    assert.equal(launch.sessionStatus, "ready");

    const firstResult = await adapter.sendPrompt({
      session,
      prompt: "Reply with exactly OK.",
      hooks: {
        onOutput: (entry) => outputs.push(entry),
        onExit: (entry) => exits.push(entry),
        onMetadata: (entry) => metadata.push(entry)
      }
    });

    assert.equal(firstResult.sessionStatus, "running");
    assert.equal(invocations[0].command, "cmd.exe");
    assert.deepEqual(invocations[0].args, [
      "/d",
      "/s",
      "/c",
      'codex exec --json "Reply with exactly OK." --skip-git-repo-check'
    ]);

    children[0].stdout.write('{"type":"thread.started","thread_id":"thread-123"}\n');
    children[0].stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\n');
    children[0].emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(metadata[0], {
      driver: "exec-json",
      codexThreadId: "thread-123",
      codexResumeMode: null
    });
    assert.equal(outputs[0].content, "OK");
    assert.equal(exits[0].nextStatus, "ready");
    assert.equal(exits[0].preserveBinding, true);

    const resumedSession = {
      ...session,
      codexThreadId: "thread-123"
    };

    await adapter.sendPrompt({
      session: resumedSession,
      prompt: "Reply with exactly STILL_OK.",
      hooks: {
        onOutput: (entry) => outputs.push(entry),
        onExit: (entry) => exits.push(entry),
        onMetadata: (entry) => metadata.push(entry)
      }
    });

    assert.equal(invocations[1].command, "cmd.exe");
    assert.deepEqual(invocations[1].args, [
      "/d",
      "/s",
      "/c",
      'codex exec resume thread-123 --json "Reply with exactly STILL_OK." --skip-git-repo-check'
    ]);

    children[1].stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"STILL_OK"}}\n');
    children[1].emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outputs[1].content, "STILL_OK");

    const latestSession = {
      ...session,
      codexResumeMode: "last"
    };

    await adapter.sendPrompt({
      session: latestSession,
      prompt: "Reply with exactly LAST_OK.",
      hooks: {
        onOutput: (entry) => outputs.push(entry),
        onExit: (entry) => exits.push(entry),
        onMetadata: (entry) => metadata.push(entry)
      }
    });

    assert.equal(invocations[2].command, "cmd.exe");
    assert.deepEqual(invocations[2].args, [
      "/d",
      "/s",
      "/c",
      "codex exec resume --last --json \"Reply with exactly LAST_OK.\" --skip-git-repo-check"
    ]);

    children[2].stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"LAST_OK"}}\n');
    children[2].emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outputs[2].content, "LAST_OK");
  });

  await runCase("starts a shell-backed PTY session, writes prompts, and kills via process tree on Windows", async () => {
    const invocations = [];
    const outputs = [];
    const exits = [];
    const killedPids = [];
    let fakePty;

    const adapter = new PtyCodexAdapter({
      command: "codex",
      platform: "win32",
      startupProbeMs: 5,
      terminalCommand: "cmd.exe",
      ptyFactory: (command, args, options) => {
        invocations.push({ command, args, options });
        fakePty = new FakePtyProcess();
        fakePty.killError = new Error("AttachConsole failed");
        return fakePty;
      },
      killProcessTree: async (pid) => {
        killedPids.push(pid);
        fakePty.emitExit({ exitCode: 0, signal: 0 });
      }
    });

    const session = {
      sessionId: "session-0001",
      projectName: "demo",
      projectRoot: "F:/Project/codex-puppeteer",
      launchMode: "background"
    };

    const launch = await adapter.createSession({
      session,
      hooks: {
        onOutput: (entry) => outputs.push(entry),
        onExit: (entry) => exits.push(entry)
      }
    });

    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].command, "cmd.exe");
    assert.deepEqual(invocations[0].args, ["/d", "/c", "codex --no-alt-screen"]);
    assert.equal(invocations[0].options.cwd, "F:/Project/codex-puppeteer");
    assert.equal(invocations[0].options.useConpty, true);
    assert.equal(launch.pid, 2468);
    assert.equal(launch.driver, "pty-shell");
    assert.equal(launch.sessionStatus, "running");
    assert.equal(launch.terminalCommand, "cmd.exe");

    const runtime = adapter.sessions.get(session.sessionId);
    runtime.terminal.emitData("hello from codex\r\n");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outputs[0].content, "hello from codex\r\n");

    await adapter.sendPrompt({ session, prompt: "Refactor auth" });
    assert.deepEqual(runtime.terminal.writes, ["Refactor auth\r"]);

    await adapter.killSession({ session });
    assert.deepEqual(killedPids, [2468]);
    assert.equal(exits.length, 1);
    assert.equal(exits[0].sessionId, "session-0001");
    assert.equal(fakePty.killCalls, 0);
    assert.equal(fakePty.socketListenersRemoved, true);
    assert.equal(fakePty.socketDestroyed, true);
    assert.equal(fakePty.inSocketDestroyed, true);
    assert.equal(fakePty.outSocketDestroyed, true);
    assert.equal(fakePty.conoutDisposed, true);
    assert.equal(adapter.sessions.has(session.sessionId), false);
  });

  await runCase("auto-continues the initial trust prompt in PTY mode", async () => {
    const fakePty = new FakePtyProcess();
    const adapter = new PtyCodexAdapter({
      command: "codex",
      platform: "win32",
      startupProbeMs: 5,
      terminalCommand: "cmd.exe",
      ptyFactory: () => {
        setTimeout(() => {
          fakePty.emitData("Do you trust the contents of this directory?\nPress enter to continue\n");
        }, 0);
        return fakePty;
      }
    });

    const session = {
      sessionId: "session-0002",
      projectName: "demo",
      projectRoot: "F:/Project/codex-puppeteer",
      launchMode: "background"
    };

    await adapter.createSession({ session });
    assert.deepEqual(fakePty.writes, ["\r"]);
  });

  await runCase("fails fast when the shell reports that codex is not available", async () => {
    const fakePty = new FakePtyProcess();
    let terminatedPid = null;
    const adapter = new PtyCodexAdapter({
      command: "codex",
      platform: "win32",
      startupProbeMs: 5,
      terminalCommand: "cmd.exe",
      ptyFactory: () => {
        setTimeout(() => {
          fakePty.emitData("'codex' is not recognized as an internal or external command\r\n");
        }, 0);
        return fakePty;
      },
      killProcessTree: async (pid) => {
        terminatedPid = pid;
        fakePty.emitExit({ exitCode: 1, signal: 0 });
      }
    });

    const session = {
      sessionId: "session-0003",
      projectName: "demo",
      projectRoot: "F:/Project/codex-puppeteer",
      launchMode: "background"
    };

    await assert.rejects(
      () => adapter.createSession({ session }),
      (error) => {
        assert.equal(error.code, "codex_cli_unavailable");
        assert.match(error.details.startupOutput, /not recognized/i);
        assert.equal(error.details.driver, "pty-shell");
        return true;
      }
    );

    assert.equal(terminatedPid, 2468);
    assert.equal(adapter.sessions.has(session.sessionId), false);
  });

  await runCase("starts a subprocess-backed session and writes prompts to stdin", async () => {
    const invocations = [];
    const outputs = [];
    const exits = [];

    const adapter = new SubprocessCodexAdapter({
      command: "codex",
      env: {},
      platform: "win32",
      startupProbeMs: 5,
      spawnFactory: (command, args, options) => {
        invocations.push({ command, args, options });
        return new FakeChildProcess();
      }
    });

    const session = {
      sessionId: "session-0010",
      projectName: "demo",
      projectRoot: "F:/Project/codex-puppeteer",
      launchMode: "background"
    };

    const launch = await adapter.createSession({
      session,
      hooks: {
        onOutput: (entry) => outputs.push(entry),
        onExit: (entry) => exits.push(entry)
      }
    });

    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].command, "cmd.exe");
    assert.deepEqual(invocations[0].args, ["/d", "/s", "/c", "codex"]);
    assert.equal(invocations[0].options.cwd, "F:/Project/codex-puppeteer");
    assert.equal(launch.pid, 4321);
    assert.equal(launch.sessionStatus, "running");

    const runtime = adapter.sessions.get(session.sessionId);
    runtime.child.stdout.write("hello from codex\n");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outputs[0].content, "hello from codex\n");

    await adapter.sendPrompt({ session, prompt: "Refactor auth" });
    assert.deepEqual(runtime.child.stdin.writes, ["Refactor auth\n"]);

    await adapter.killSession({ session });
    assert.equal(exits.length, 1);
    assert.equal(exits[0].sessionId, "session-0010");
  });

  await runCase("fails fast when the pipe driver reports that stdin is not a terminal", async () => {
    const adapter = new SubprocessCodexAdapter({
      command: "codex",
      platform: "win32",
      startupProbeMs: 20,
      spawnFactory: () => new TerminalRequiredChildProcess()
    });

    const session = {
      sessionId: "session-0009",
      projectName: "demo",
      projectRoot: "F:/Project/codex-puppeteer",
      launchMode: "background"
    };

    await assert.rejects(
      () => adapter.createSession({ session }),
      (error) => {
        assert.equal(error.code, "codex_terminal_required");
        assert.match(error.message, /terminal-compatible session/i);
        assert.match(error.details.startupOutput, /stdin is not a terminal/i);
        return true;
      }
    );

    assert.equal(adapter.sessions.has(session.sessionId), false);
  });

  await runCase("reads project files through the adapter helper", async () => {
    const adapter = new SimulatedCodexAdapter();
    const result = await adapter.readFile({
      absolutePath: `${process.cwd()}/README.md`,
      relativePath: "README.md"
    });

    assert.equal(result.actionId, "read");
    assert.equal(result.relativePath, "README.md");
    assert.match(result.content, /codex-puppeteer/i);
  });
}




