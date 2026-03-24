import fs from "node:fs";
import path from "node:path";

function formatMeta(meta) {
  if (meta === undefined) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function dateStamp(timestamp) {
  return timestamp.slice(0, 10);
}

export class FileLogger {
  constructor({
    logDir = path.resolve(process.cwd(), ".agent/logs"),
    serviceName = "wxcodex-agent",
    mirrorConsole = true
  } = {}) {
    this.logDir = logDir;
    this.serviceName = serviceName;
    this.mirrorConsole = mirrorConsole;
    ensureDirectory(this.logDir);
  }

  debug(message, meta) {
    this.log("DEBUG", message, meta);
  }

  info(message, meta) {
    this.log("INFO", message, meta);
  }

  warn(message, meta) {
    this.log("WARN", message, meta);
  }

  error(message, meta) {
    this.log("ERROR", message, meta);
  }

  log(level, message, meta) {
    const timestamp = new Date().toISOString();
    const record = `${timestamp} [${level}] ${message}${formatMeta(meta)}\n`;
    const filePath = path.join(this.logDir, `${this.serviceName}-${dateStamp(timestamp)}.log`);
    fs.appendFileSync(filePath, record, "utf8");

    if (this.mirrorConsole) {
      const consoleMethod = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
      console[consoleMethod]?.(record.trimEnd());
    }
  }
}
