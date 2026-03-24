function normalizePath(targetPath) {
  return String(targetPath).replace(/\\/g, "/");
}

const workspaceRoot = normalizePath(process.cwd());

export const defaultConfig = {
  security: {
    allowedSources: ["owner.wechat"],
    shutdownPassword: "CONFIRM_SHUTDOWN",
    allowedProjectRoots: [workspaceRoot]
  },
  runtime: {
    defaultLaunchMode: "background",
    defaultPermissionMode: "manual",
    defaultExecProfile: "safe",
    autoPermissionExecProfile: "full-auto",
    codexSandboxMode: null,
    maxBufferedLines: 500,
    defaultScreenLines: 20,
    defaultWaitIdleMs: 3000,
    defaultWaitTimeoutMs: 120000,
    defaultSendWaitTimeoutMs: 3600000,
    defaultWaitPollMs: 500,
    storageDir: `${workspaceRoot}/.agent/runtime`,
    sessionsFilePath: `${workspaceRoot}/.agent/runtime/sessions.json`,
    tasksFilePath: `${workspaceRoot}/.agent/runtime/tasks.json`,
    sourceBindingsFilePath: `${workspaceRoot}/.agent/runtime/source-bindings.json`
  },
  system: {
    actionMode: "dry-run"
  },
  service: {
    serviceName: "wxcodex-agent",
    logDir: `${workspaceRoot}/.agent/logs`,
    envFiles: [".env"],
    notifyOnFatal: true
  },
  projects: {
    demo: {
      alias: "demo",
      projectName: "demo",
      rootPath: workspaceRoot,
      defaultFile: "README.md"
    },
    docs: {
      alias: "docs",
      projectName: "docs",
      rootPath: `${workspaceRoot}/docs`,
      defaultFile: "requirements.md"
    }
  },
  wecom: {
    callbackPath: "/wecom/callback",
    port: 8787,
    corpId: "",
    agentId: "",
    corpSecret: "",
    token: "",
    encodingAESKey: "",
    receiveId: "",
    passiveReplyMode: "text",
    commandDispatchMode: "async",
    defaultRecipient: "",
    allowedSources: ["owner.wechat"],
    maxMessageLength: 1200
  },
  telegram: {
    botToken: "",
    apiBaseUrl: "https://api.telegram.org",
    defaultRecipient: "",
    allowedChatIds: [],
    pollIntervalMs: 1000,
    longPollTimeoutSec: 20,
    commandDispatchMode: "async",
    maxMessageLength: 3500,
    transport: "auto"
  }
};
