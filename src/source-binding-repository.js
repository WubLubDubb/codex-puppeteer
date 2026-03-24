import { loadJsonFile, writeJsonFileAtomic } from "./storage-utils.js";

function now() {
  return new Date().toISOString();
}

function normalizeBinding(entry) {
  return {
    sourceId: String(entry?.sourceId ?? ""),
    sessionId: entry?.sessionId ? String(entry.sessionId) : null,
    updatedAt: entry?.updatedAt ?? now()
  };
}

export class InMemorySourceBindingRepository {
  constructor() {
    this.bindings = new Map();
  }

  getBinding(sourceId) {
    const binding = this.bindings.get(String(sourceId ?? ""));
    return binding ? structuredClone(binding) : null;
  }

  setBinding({ sourceId, sessionId }) {
    const record = {
      sourceId: String(sourceId ?? ""),
      sessionId: String(sessionId ?? ""),
      updatedAt: now()
    };

    this.bindings.set(record.sourceId, record);
    this._afterChange();
    return structuredClone(record);
  }

  clearBinding(sourceId) {
    const deleted = this.bindings.delete(String(sourceId ?? ""));
    if (deleted) {
      this._afterChange();
    }
    return deleted;
  }

  clearBindingsForSession(sessionId) {
    const clearedSourceIds = [];

    for (const [sourceId, binding] of this.bindings.entries()) {
      if (binding.sessionId !== sessionId) {
        continue;
      }

      this.bindings.delete(sourceId);
      clearedSourceIds.push(sourceId);
    }

    if (clearedSourceIds.length > 0) {
      this._afterChange();
    }

    return clearedSourceIds;
  }

  listBindings() {
    return Array.from(this.bindings.values(), (binding) => structuredClone(binding));
  }

  getStorageSnapshot() {
    return {
      bindings: this.listBindings()
    };
  }

  _importState(state) {
    this.bindings = new Map();

    for (const entry of Array.isArray(state?.bindings) ? state.bindings : []) {
      const normalized = normalizeBinding(entry);
      if (!normalized.sourceId || !normalized.sessionId) {
        continue;
      }

      this.bindings.set(normalized.sourceId, normalized);
    }
  }

  _afterChange() {}
}

export class FileSourceBindingRepository extends InMemorySourceBindingRepository {
  constructor({ storageFilePath } = {}) {
    super();
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

    writeJsonFileAtomic(this.storageFilePath, this.getStorageSnapshot());
  }
}
