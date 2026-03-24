import { spawn } from "node:child_process";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killWindowsProcessTree(pid, { spawnFactory = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let killer;

    try {
      killer = spawnFactory("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        shell: false
      });
    } catch (error) {
      reject(error);
      return;
    }

    killer.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    killer.once("error", (error) => {
      reject(error);
    });

    killer.once("exit", (code) => {
      if (code === 0) {
        resolve({ found: true, method: "taskkill" });
        return;
      }

      if (
        /There is no running instance of the task/i.test(stderr) ||
        /not found/i.test(stderr) ||
        /cannot find/i.test(stderr)
      ) {
        resolve({ found: false, method: "taskkill" });
        return;
      }

      reject(new Error(stderr.trim() || `taskkill exited with code ${code ?? "null"}.`));
    });
  });
}

async function killPosixProcess(pid, {
  killImpl = process.kill,
  graceMs = 500,
  initialSignal = "SIGTERM",
  forceSignal = "SIGKILL"
} = {}) {
  try {
    killImpl(pid, initialSignal);
  } catch (error) {
    if (error?.code === "ESRCH") {
      return { found: false, method: "signal", signal: initialSignal };
    }

    throw error;
  }

  await delay(graceMs);

  try {
    killImpl(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") {
      return { found: true, method: "signal", signal: initialSignal };
    }

    throw error;
  }

  try {
    killImpl(pid, forceSignal);
  } catch (error) {
    if (error?.code === "ESRCH") {
      return { found: true, method: "signal", signal: initialSignal };
    }

    throw error;
  }

  return { found: true, method: "signal", signal: forceSignal };
}

export async function cleanupProcessTree({
  pid,
  platform = process.platform,
  spawnFactory = spawn,
  killImpl = process.kill
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      cleaned: false,
      reason: "pid_invalid",
      method: null
    };
  }

  if (platform === "win32") {
    const result = await killWindowsProcessTree(pid, { spawnFactory });
    return {
      cleaned: result.found,
      reason: result.found ? "killed" : "not_found",
      method: result.method
    };
  }

  const result = await killPosixProcess(pid, { killImpl });
  return {
    cleaned: result.found,
    reason: result.found ? "killed" : "not_found",
    method: result.method,
    signal: result.signal
  };
}
