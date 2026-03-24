import fs from "node:fs";
import path from "node:path";

export function ensureParentDirectory(filePath) {
  if (!filePath) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function loadJsonFile(filePath, fallbackValue = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallbackValue;
  }

  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return fallbackValue;
  }

  return JSON.parse(content);
}

export function writeJsonFileAtomic(filePath, value) {
  if (!filePath) {
    return;
  }

  ensureParentDirectory(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function resolveWorkspacePath(targetPath, cwd = process.cwd()) {
  if (!targetPath) {
    return cwd;
  }

  return path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
}
