import { loadJsonFile, writeJsonFileAtomic } from "./storage-utils.js";

function now() {
  return new Date().toISOString();
}

function isActiveStatus(status) {
  return status === "starting" || status === "running";
}

function stripAnsi(content) {
  return String(content ?? "")
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function deriveSessionSequence(sessionId) {
  const match = /^session-(\d+)$/.exec(String(sessionId ?? ""));
  return match ? Number(match[1]) : 0;
}

function normalizeOutputEntry(entry) {
  return {
    seq: Number(entry?.seq ?? 0),
    stream: entry?.stream ?? "stdout",
    line: String(entry?.line ?? ""),
    at: entry?.at ?? now()
  };
}

function normalizeLoadedSession(session, maxBufferedLines) {
  const outputBuffer = Array.isArray(session?.outputBuffer)
    ? session.outputBuffer.map(normalizeOutputEntry).slice(-maxBufferedLines)
    : [];
  const lastOutputSequence = outputBuffer.length > 0
    ? outputBuffer[outputBuffer.length - 1].seq
    : Number(session?.lastOutputSequence ?? 0);

  return {
    sessionId: session.sessionId,
    workspaceAlias: session.workspaceAlias ?? null,
    projectName: session.projectName,
    projectRoot: session.projectRoot,
    defaultFile: session.defaultFile ?? null,
    launchMode: session.launchMode ?? "background",
    permissionMode: session.permissionMode ?? "manual",
    driver: session.driver ?? null,
    codexThreadId: session.codexThreadId ?? null,
    codexResumeMode: session.codexResumeMode ?? null,
    status: session.status ?? "starting",
    pid: session.pid ?? null,
    exitCode: session.exitCode ?? null,
    signal: session.signal ?? null,
    outputBuffer,
    lastOutputSequence,
    nextOutputSequence: Math.max(Number(session?.nextOutputSequence ?? 0), lastOutputSequence + 1),
    recovery: session.recovery ?? null,
    createdAt: session.createdAt ?? now(),
    updatedAt: session.updatedAt ?? now(),
    startedAt: session.startedAt ?? session.createdAt ?? now(),
    endedAt: session.endedAt ?? null,
    lastActivityAt: session.lastActivityAt ?? session.updatedAt ?? now()
  };
}

export class InMemorySessionRepository {
  constructor({ maxBufferedLines = 200 } = {}) {
    this.maxBufferedLines = maxBufferedLines;
    this.sessions = new Map();
    this.sequence = 0;
  }

  nextSessionId() {
    this.sequence += 1;
    return `session-${String(this.sequence).padStart(4, "0")}`;
  }

  createSession(session) {
    const timestamp = now();
    const record = {
      sessionId: session.sessionId,
      workspaceAlias: session.workspaceAlias ?? null,
      projectName: session.projectName,
      projectRoot: session.projectRoot,
      defaultFile: session.defaultFile ?? null,
      launchMode: session.launchMode ?? "background",
      permissionMode: session.permissionMode ?? "manual",
      driver: session.driver ?? null,
      codexThreadId: session.codexThreadId ?? null,
      codexResumeMode: session.codexResumeMode ?? null,
      status: session.status ?? "starting",
      pid: session.pid ?? null,
      exitCode: null,
      signal: null,
      outputBuffer: [],
      lastOutputSequence: 0,
      nextOutputSequence: 1,
      recovery: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      lastActivityAt: timestamp
    };

    this.sessions.set(record.sessionId, record);
    this.sequence = Math.max(this.sequence, deriveSessionSequence(record.sessionId));
    this._afterChange();
    return this.getSession(record.sessionId);
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    this._afterChange();
  }

  markRunning(sessionId, extra = {}) {
    this.#mutate(sessionId, (session) => {
      session.status = "running";
      session.pid = extra.pid ?? session.pid;
      session.driver = extra.driver ?? session.driver;
      session.codexThreadId = extra.codexThreadId ?? session.codexThreadId;
      session.codexResumeMode = extra.codexResumeMode ?? session.codexResumeMode;
      session.exitCode = null;
      session.signal = null;
      session.recovery = null;
      session.lastActivityAt = now();
    });
  }

  markReady(sessionId, extra = {}) {
    this.#mutate(sessionId, (session) => {
      session.status = "ready";
      session.pid = extra.pid ?? null;
      session.driver = extra.driver ?? session.driver;
      session.codexThreadId = extra.codexThreadId ?? session.codexThreadId;
      session.codexResumeMode = extra.codexResumeMode ?? session.codexResumeMode;
      session.exitCode = extra.exitCode ?? session.exitCode;
      session.signal = extra.signal ?? session.signal;
      session.recovery = null;
      session.lastActivityAt = now();
    });
  }

  updateSession(sessionId, extra = {}) {
    this.#mutate(sessionId, (session) => {
      if (Object.hasOwn(extra, "pid")) {
        session.pid = extra.pid;
      }

      if (Object.hasOwn(extra, "driver")) {
        session.driver = extra.driver;
      }

      if (Object.hasOwn(extra, "codexThreadId")) {
        session.codexThreadId = extra.codexThreadId;
      }

      if (Object.hasOwn(extra, "codexResumeMode")) {
        session.codexResumeMode = extra.codexResumeMode;
      }

      session.lastActivityAt = now();
    });
  }

  markExited(sessionId, { exitCode = null, signal = null, status = "exited", driver = undefined, codexThreadId = undefined, codexResumeMode = undefined } = {}) {
    this.#mutate(sessionId, (session) => {
      const terminalStatus = session.status === "killed" ? "killed" : status;
      session.status = terminalStatus;
      session.exitCode = exitCode;
      session.signal = signal;
      session.driver = driver ?? session.driver;
      session.codexThreadId = codexThreadId ?? session.codexThreadId;
      session.codexResumeMode = codexResumeMode ?? session.codexResumeMode;
      session.endedAt = now();
      session.lastActivityAt = now();
    });
  }

  markKilled(sessionId) {
    this.#mutate(sessionId, (session) => {
      session.status = "killed";
      session.endedAt = now();
      session.lastActivityAt = now();
    });
  }

  markRecovered(sessionId, {
    status = "recovered_killed",
    exitCode = null,
    signal = null,
    recovery = {}
  } = {}) {
    this.#mutate(sessionId, (session) => {
      const timestamp = now();
      session.status = status;
      session.exitCode = exitCode;
      session.signal = signal;
      session.endedAt = session.endedAt ?? timestamp;
      session.lastActivityAt = timestamp;
      session.recovery = {
        ...structuredClone(recovery),
        recoveredAt: timestamp
      };
    });
  }

  setPermissionMode(sessionId, permissionMode) {
    this.#mutate(sessionId, (session) => {
      session.permissionMode = permissionMode;
      session.lastActivityAt = now();
    });
  }

  appendOutput(sessionId, { stream = "stdout", content }) {
    this.#mutate(sessionId, (session) => {
      const normalizedContent = stripAnsi(String(content ?? "")).replace(/\r/g, "");
      const lines = normalizedContent
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line !== "");

      const timestamp = now();
      for (const line of lines) {
        const seq = session.nextOutputSequence;
        session.nextOutputSequence += 1;
        session.lastOutputSequence = seq;
        session.outputBuffer.push({
          seq,
          stream,
          line,
          at: timestamp
        });
      }

      if (session.outputBuffer.length > this.maxBufferedLines) {
        session.outputBuffer.splice(0, session.outputBuffer.length - this.maxBufferedLines);
      }

      session.lastActivityAt = timestamp;
    });
  }

  getLatestOutputSequence(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.lastOutputSequence : null;
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? this._snapshot(session) : null;
  }

  listSessions() {
    return Array.from(this.sessions.values(), (session) => this._snapshot(session));
  }

  listActiveSessions() {
    return this.listSessions().filter((session) => isActiveStatus(session.status));
  }

  getScreen(sessionId, { limit = 20, afterSequence = null } = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const filteredOutput =
      Number.isInteger(afterSequence) && afterSequence >= 0
        ? session.outputBuffer.filter((entry) => entry.seq > afterSequence)
        : session.outputBuffer;

    return structuredClone(filteredOutput.slice(-limit));
  }

  getStorageSnapshot() {
    return this._exportState();
  }

  _snapshot(session) {
    const { nextOutputSequence, ...snapshot } = session;
    return structuredClone(snapshot);
  }

  _exportState() {
    return {
      sequence: this.sequence,
      maxBufferedLines: this.maxBufferedLines,
      sessions: Array.from(this.sessions.values(), (session) => structuredClone(session))
    };
  }

  _importState(state) {
    this.sequence = Number(state?.sequence ?? 0);
    this.maxBufferedLines = Number(state?.maxBufferedLines ?? this.maxBufferedLines);
    this.sessions = new Map();

    for (const session of Array.isArray(state?.sessions) ? state.sessions : []) {
      const normalized = normalizeLoadedSession(session, this.maxBufferedLines);
      this.sessions.set(normalized.sessionId, normalized);
      this.sequence = Math.max(this.sequence, deriveSessionSequence(normalized.sessionId));
    }
  }

  _afterChange() {}

  #mutate(sessionId, updater) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Unknown session "${sessionId}".`);
    }

    updater(session);
    session.updatedAt = now();
    this._afterChange();
  }
}

export class FileSessionRepository extends InMemorySessionRepository {
  constructor({ storageFilePath, ...options } = {}) {
    super(options);
    this.storageFilePath = storageFilePath ?? null;

    if (this.storageFilePath) {
      const state = loadJsonFile(this.storageFilePath, null);
      if (state) {
        this._importState(state);
      } else {
        this._afterChange();
      }
    }
  }

  _afterChange() {
    if (!this.storageFilePath) {
      return;
    }

    writeJsonFileAtomic(this.storageFilePath, this._exportState());
  }
}

