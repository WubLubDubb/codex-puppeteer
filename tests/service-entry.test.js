import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createServiceRuntimeConfigFromEnv } from "../src/service-entry.js";

function createTempDir(prefix) {
  const tempDir = path.join(process.cwd(), "tmp", `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export async function runServiceEntryTests(runCase) {
  await runCase("builds managed service config with storage, log, and system mode overrides", async () => {
    const tempDir = createTempDir("service-config");
    const config = createServiceRuntimeConfigFromEnv({
      cwd: process.cwd(),
      env: {
        CODEX_PUPPETEER_STORAGE_DIR: `${tempDir}/runtime`,
        CODEX_PUPPETEER_LOG_DIR: `${tempDir}/logs`,
        CODEX_PUPPETEER_SYSTEM_MODE: "real",
        CODEX_PUPPETEER_ENV_FILES: ".env,.env.local",
        CODEX_PUPPETEER_ALLOWED_PROJECT_ROOTS: "F:/project,D:/workspace",
        WECOM_MAX_MESSAGE_LENGTH: "2400"
      }
    });

    assert.match(config.runtime.sessionsFilePath, /sessions\.json$/);
    assert.match(config.runtime.tasksFilePath, /tasks\.json$/);
    assert.match(config.runtime.sourceBindingsFilePath, /source-bindings\.json$/);
    assert.equal(config.system.actionMode, "real");
    assert.deepEqual(config.service.envFiles, [".env", ".env.local"]);
    assert.deepEqual(config.security.allowedProjectRoots, ["F:/project", "D:/workspace"]);
    assert.equal(config.wecom.maxMessageLength, 2400);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}
