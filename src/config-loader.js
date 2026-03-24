import fs from "node:fs";

export function parseEnvText(text) {
  const values = {};
  const lines = String(text ?? "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value.replace(/\\n/g, "\n");
  }

  return values;
}

export function loadEnvFile({ filePath, env = process.env, override = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      filePath,
      loaded: false,
      values: {}
    };
  }

  const parsed = parseEnvText(fs.readFileSync(filePath, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    if (override || env[key] === undefined) {
      env[key] = value;
    }
  }

  return {
    filePath,
    loaded: true,
    values: parsed
  };
}

export function loadRuntimeEnvironment({
  env = process.env,
  cwd = process.cwd(),
  envFileNames = [".env"]
} = {}) {
  const results = [];

  for (const fileName of envFileNames) {
    const filePath = fileName.includes(":") || fileName.startsWith("/") || fileName.startsWith("\\")
      ? fileName
      : `${cwd}/${fileName}`.replace(/\\/g, "/");
    results.push(loadEnvFile({ filePath, env }));
  }

  return {
    env,
    files: results
  };
}
