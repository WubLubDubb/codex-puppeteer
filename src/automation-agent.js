import { createPreferredCodexAdapter } from "./codex-adapter.js";
import { ProjectContextResolver } from "./context-resolver.js";
import { defaultConfig } from "./default-config.js";
import { analyzeCodexOutputLines } from "./output-analysis.js";
import {
  CommandValidationError,
  ConfigurationError,
  ContextResolutionError,
  AuthorizationError,
  serializeError
} from "./errors.js";
import { CommandParser } from "./message-parser.js";
import { InMemoryNotifier } from "./notifier.js";
import { PolicyEngine } from "./policy-engine.js";
import { InMemorySessionRepository } from "./session-repository.js";
import { InMemorySourceBindingRepository } from "./source-binding-repository.js";
import { DryRunSystemAdapter } from "./system-adapter.js";
import { InMemoryTaskRepository } from "./task-repository.js";

function now() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRejectedError(error) {
  return (
    error instanceof CommandValidationError ||
    error instanceof ConfigurationError ||
    error instanceof ContextResolutionError ||
    error instanceof AuthorizationError
  );
}

function requireStringFlag(args, key, message) {
  if (typeof args[key] !== "string" || args[key].trim() === "") {
    throw new CommandValidationError(message, "command_argument_missing", { key });
  }

  return args[key].trim();
}

function parseOptionalNonNegativeIntegerFlag(args, key, message) {
  if (args[key] === undefined) {
    return null;
  }

  const value = Number(args[key]);

  if (!Number.isInteger(value) || value < 0) {
    throw new CommandValidationError(message, "command_argument_invalid", {
      key,
      value: args[key]
    });
  }

  return value;
}

function isSessionExecutionStatus(status) {
  return status === "starting" || status === "running";
}

function isSessionAvailableStatus(status) {
  return isSessionExecutionStatus(status) || status === "ready";
}

function requiresProcessExitForWait(session) {
  return session?.driver === "exec-json";
}

function isLogicalSessionId(value) {
  return /^session-\d+$/i.test(String(value ?? "").trim());
}

function truncateText(value, maxLength = 3000) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function shortenIdentifier(value, prefixLength = 8, suffixLength = 4) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  if (text.length <= prefixLength + suffixLength + 3) {
    return text;
  }

  return `${text.slice(0, prefixLength)}...${text.slice(-suffixLength)}`;
}

function formatSessionLine(session, activeSessionId = null, selectionIndex = null) {
  const prefix = session.sessionId === activeSessionId ? "* " : "";
  const sessionLabel = selectionIndex === null ? session.sessionId : `${selectionIndex}. ${session.sessionId}`;
  const resumeTarget = session.codexThreadId
    ? ` | codex=${shortenIdentifier(session.codexThreadId)}`
    : session.codexResumeMode === "last"
      ? " | codex=last"
      : "";
  return `${prefix}${sessionLabel} | ${session.projectName} | ${session.status}${resumeTarget}`;
}

function formatSystemSnapshot(snapshot) {
  if (!snapshot) {
    return "System probe collected.";
  }

  return [
    "System status:",
    `platform: ${snapshot.platform}`,
    `activeSessions: ${snapshot.activeSessions}`,
    `cpuCount: ${snapshot.cpuCount}`,
    `freeMemory: ${snapshot.freeMemory}`,
    `totalMemory: ${snapshot.totalMemory}`
  ].join("\n");
}

function formatConfiguredProjectLine(project) {
  const alias = String(project?.alias ?? "").trim();
  const projectName = String(project?.projectName ?? "").trim();
  const projectRoot = String(project?.projectRoot ?? "").trim();
  const pathSegments = projectRoot.split(/[\\/]/).filter(Boolean);
  const baseName = pathSegments.at(-1) ?? "";
  const parentName = pathSegments.at(-2) ?? "";

  if (projectName && projectName.localeCompare(alias, undefined, { sensitivity: "base" }) !== 0) {
    return `- ${alias} -> ${projectName}`;
  }

  if (baseName && baseName.localeCompare(alias, undefined, { sensitivity: "base" }) !== 0) {
    return `- ${alias} -> ${baseName}`;
  }

  const compactTarget = parentName && baseName ? `${parentName}/${baseName}` : projectRoot || alias;
  return `- ${alias} -> ${compactTarget}`;
}

function formatDiscoveredProjectLine(project) {
  return `- ${project.name}`;
}

function formatBrowseRelativePath(relativePath) {
  const normalized = String(relativePath ?? "").trim().replace(/\\/g, "/");
  return normalized ? normalized : "/";
}

function formatBrowseEntryLine(entry, { showRelativePath = false } = {}) {
  const label = entry.type === "directory" ? "dir" : "file";
  const targetPath = showRelativePath
    ? formatBrowseRelativePath(entry.relativePath)
    : entry.type === "directory"
      ? `${entry.name}/`
      : entry.name;
  return `${entry.index}. [${label}] ${targetPath}`;
}

function truncateInlineText(value, maxLength = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatCompactTimestamp(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (match) {
    return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  }

  return truncateInlineText(text || "unknown-time", 16);
}

function formatLocalCodexConversationLine(conversation, selectionIndex = null) {
  const updatedAt = formatCompactTimestamp(conversation.updatedAt);
  const title = truncateInlineText(conversation.title, 48) || "(untitled conversation)";
  const conversationLabel = selectionIndex === null
    ? conversation.codexSessionId
    : `${selectionIndex}. ${conversation.codexSessionId}`;
  return `${conversationLabel}
  ${updatedAt} | ${title}`;
}

function formatDisplayPath(targetPath) {
  const normalized = String(targetPath ?? "").trim();
  if (!normalized) {
    return "";
  }

  return process.platform === "win32" ? normalized.replace(/\//g, "\\") : normalized.replace(/\\/g, "/");
}

function formatWaitMinutes(ms) {
  const value = Number(ms ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return String(Math.max(1, Math.round(value / 60000)));
}

function buildHelpMessage(config) {
  const allowedRoots = Array.isArray(config?.security?.allowedProjectRoots)
    ? config.security.allowedProjectRoots.filter((entry) => String(entry ?? "").trim() !== "")
    : [];
  const firstRoot = allowedRoots[0]
    ? formatDisplayPath(allowedRoots[0])
    : process.platform === "win32"
      ? "F:\\project"
      : "~/project";
  const screenLines = Number(config?.runtime?.defaultScreenLines ?? 20);
  const sendWaitMinutes = formatWaitMinutes(config?.runtime?.defaultSendWaitTimeoutMs ?? 0);
  const explicitWaitMinutes = formatWaitMinutes(config?.runtime?.defaultWaitTimeoutMs ?? 0);
  const defaultPermissionMode = String(config?.runtime?.defaultPermissionMode ?? "manual");
  const manualExecProfile = String(config?.runtime?.defaultExecProfile ?? "safe");
  const autoExecProfile = String(config?.runtime?.autoPermissionExecProfile ?? "dangerous");
  const sandboxMode = config?.runtime?.codexSandboxMode ? String(config.runtime.codexSandboxMode) : "default";
  const systemMode = String(config?.system?.actionMode ?? "dry-run");

  return [
    "codex-puppeteer /help",
    "",
    "推荐主流程：",
    "1. /projects",
    "2. /create MyTask 1",
    "3. /send 请先扫描项目并总结目录结构",
    "4. /current",
    "5. 后续可直接发送普通文本续聊；切换会话时先用 /activate",
    "",
    "当前运行配置：",
    ...(allowedRoots.length > 0
      ? ["- 允许项目根目录：", ...allowedRoots.map((root) => `  - ${formatDisplayPath(root)}`)]
      : ["- 允许项目根目录：未配置"]),
    `- /send 默认等待：${sendWaitMinutes} 分钟`,
    `- /screen 默认显示：${screenLines} 行`,
    `- 显式补充查看超时：${explicitWaitMinutes} 分钟`,
    `- 默认权限模式：${defaultPermissionMode}`,
    `- manual 执行档：${manualExecProfile}`,
    `- auto 执行档：${autoExecProfile}`,
    `- sandbox：${sandboxMode}`,
    `- 系统动作模式：${systemMode}`,
    "",
    "命令列表：",
    "- /help：查看当前帮助",
    "- /projects [-w <allowedRoot>]：列出允许根目录下的项目文件夹，结果带编号",
    "- /create -n <name> -w <workspace|projectNumber>：创建新会话",
    "- /list [-a] [-c <count>]：查看托管会话和本机 Codex 历史对话",
    "- /activate -n <sessionId|codexConversationId|listNumber> [-w <workspace>]：切换当前聊天绑定的活动会话",
    "- /current：查看当前活动会话、项目路径、浏览目录和权限状态",
    "- /send [-n <sessionId|codexConversationId|listNumber>] -m <prompt>：发送任务并自动等待当前轮结果",
    "- 直接发送普通文本：发给当前活动会话",
    "- /screen [-n <sessionId|listNumber>] [-c <cursor>]：查看当前输出或增量输出；已绑定活动会话时可省略 -n",
    "- /ls [-n <sessionId|listNumber>] [-p <path|number|..|/>]：浏览当前目录或进入指定子目录",
    "- /find [-n <sessionId|listNumber>] -q <keyword> [-p <path|number|..|/>]：搜索文件或目录",
    "- /read [-n <sessionId|listNumber>] -f <path|number>：按路径或编号下载文件",
    "- /enablePermission -n <sessionId|listNumber>：把会话切到 auto 模式，适合处理审批或 sandbox 阻塞",
    "- /disablePermission -n <sessionId|listNumber>：把会话切回 manual 执行档，恢复默认执行策略",
    "- /kill -n <sessionId|listNumber>：终止指定会话",
    "- /sys：查看宿主机状态",
    "- /shutdown -a <password>：等待所有活跃会话结束后关机",
    "- /shutdown -p <password>：立即关机",
    "- /cancel_shutdown：取消自动关机计划",
    "",
    "短别名：",
    "- /h=/help, /p=/projects, /c=/create, /l=/list, /a=/activate",
    "- /s=/send, /sc=/screen, /r=/read, /cur=/current, /ctx=/current, /k=/kill",
    "- /ep=/enablePermission, /dp=/disablePermission",
    "",
    "补充说明：",
    "- /wait 已废弃，不需要再单独调用",
    "- /send 开始后会先回一条 screen 提示，你可以用 /screen 持续追踪长任务",
    "- /create 支持简写：/c MyTask 1",
    "- /send 支持简写：/s 3 继续开发；当前会话已激活时也可直接 /s 继续开发",
    "- /ls 和 /find 的结果都支持编号；可直接用 /ls -p <number> 或 /read -f <number>",
    "- 如果 /activate 的目标是历史对话且当前没有项目上下文，请补 -w <workspace>",
    "- 如果远程任务被本地审批或 sandbox 限制阻塞，可先执行 /enablePermission，处理完后再 /disablePermission",
    systemMode === "dry-run"
      ? "- 当前 /shutdown 仍是 dry-run，仅模拟执行，不会真正关机"
      : "- 当前 /shutdown 为 real 模式，使用前请确认风险"
  ].join("\n");
}

function formatCurrentContextMessage(response) {
  const sourceId = String(response?.sourceId ?? "").trim() || "(unknown)";
  const session = response?.session ?? null;

  if (!session) {
    return [
      "当前上下文：",
      `来源：${sourceId}`,
      `会话：${response?.staleBindingCleared ? "已清理失效绑定" : "未绑定"}`,
      "提示：请先使用 /projects、/create、/list 或 /activate。",
      "",
      "下一步：",
      "查看项目：/projects",
      "创建会话：/create MyTask 1",
      "切换会话：/list 或 /activate 3"
    ].join("\n");
  }

  const browseState = response?.browseState ?? {
    currentRelativePath: "",
    selectionEntries: [],
    mode: "ls",
    query: null
  };
  const sections = [
    "当前上下文：",
    `来源：${sourceId}`,
    `会话：${session.sessionId}`,
    `项目：${session.projectName}`,
    `工作区：${formatDisplayPath(session.projectRoot)}`,
    `状态：${session.status}`,
    `权限：${session.permissionMode ?? "manual"} -> ${response?.executionProfile ?? "safe"}`,
    `驱动：${session.driver ?? "(unknown)"}`,
    `浏览目录：${formatBrowseRelativePath(browseState.currentRelativePath ?? "")}`,
    `浏览模式：${browseState.mode === "find" ? "find" : "ls"}`,
    `最近条目数：${Array.isArray(browseState.selectionEntries) ? browseState.selectionEntries.length : 0}`,
    `最新游标：${response?.latestCursor ?? 0}`
  ];

  if (browseState.mode === "find" && browseState.query) {
    sections.push(`搜索关键词：${browseState.query}`);
  }

  if (session.codexThreadId) {
    sections.push(`Codex 会话：${shortenIdentifier(session.codexThreadId)}`);
  }

  if (response?.sandboxMode) {
    sections.push(`Sandbox：${response.sandboxMode}`);
  }

  sections.push(
    "",
    "下一步：",
    "继续对话：直接发送普通文本，或 /send 继续开发",
    "查看输出：/screen",
    "浏览文件：/ls",
    "切换会话：/list 或 /activate"
  );

  return sections.join("\n");
}
function formatCommandResponseMessage(response) {
  if (!response || typeof response !== "object") {
    return "Command completed.";
  }

  switch (response.actionId) {
    case "create":
    case "activate":
      return [
        response.summary,
        response.session?.projectRoot ? `workspace: ${response.session.projectRoot}` : null
      ]
        .filter(Boolean)
        .join("\n");
    case "list": {
      const managedSessions = Array.isArray(response.sessions) ? response.sessions : [];
      const localCodexSessions = Array.isArray(response.localCodexSessions)
        ? response.localCodexSessions
        : [];
      const selectionEntries = Array.isArray(response.selectionEntries)
        ? response.selectionEntries
        : [];
      const totalLocalCodexSessions = response.totalLocalCodexSessions ?? localCodexSessions.length;
      const managedSelectionBySessionId = new Map(
        selectionEntries
          .filter((entry) => entry?.type === "managed" && entry?.sessionId)
          .map((entry) => [entry.sessionId, entry.index])
      );
      const localSelectionByConversationId = new Map(
        selectionEntries
          .filter((entry) => entry?.type === "local" && entry?.codexSessionId)
          .map((entry) => [entry.codexSessionId, entry.index])
      );
      const sections = [`Current sessions (${managedSessions.length}):`];

      if (managedSessions.length > 0) {
        sections.push(
          ...managedSessions.map((session) =>
            formatSessionLine(
              session,
              response.activeSessionId,
              managedSelectionBySessionId.get(session.sessionId) ?? null
            )
          )
        );
      } else {
        sections.push("- (none)");
      }

      if (response.localCodexHistoryError) {
        sections.push(`Recent history: unavailable (${response.localCodexHistoryError})`);
      } else {
        sections.push(`Recent history (${localCodexSessions.length}/${totalLocalCodexSessions}):`);

        if (localCodexSessions.length > 0) {
          sections.push(
            ...localCodexSessions.map((conversation) =>
              formatLocalCodexConversationLine(
                conversation,
                localSelectionByConversationId.get(conversation.codexSessionId) ?? null
              )
            )
          );
        } else {
          sections.push("- (none)");
        }

        if (response.omittedLocalCodexSessions > 0) {
          sections.push(`- +${response.omittedLocalCodexSessions} more history item(s). Use /list -a or /list -c ${totalLocalCodexSessions > 20 ? 20 : totalLocalCodexSessions}.`);
        }
      }

      return sections.join("\n");
    }
    case "projects":
      return response.rendered ? truncateText(response.rendered) : response.summary;
    case "ls":
    case "find":
      return response.rendered ? truncateText(response.rendered, 6000) : response.summary;
    case "help":
      return response.rendered ? truncateText(response.rendered, 6000) : response.summary;
    case "current":
      return formatCurrentContextMessage(response);
    case "send": {
      const sessionLabel = response.session?.sessionId ?? response.sessionId ?? "unknown";
      const hasSettledAssistantReply =
        response.status === "settled" && response.completionState === "assistant_answer_detected";

      if (response.assistantText) {
        return hasSettledAssistantReply
          ? `Session ${sessionLabel} assistant output:
${response.assistantText}`
          : `Session ${sessionLabel} partial assistant output (${response.status ?? "unknown"}, ${response.completionState ?? "unknown"}):
${response.assistantText}`;
      }

      return [
        response.summary,
        response.rendered ? truncateText(response.rendered) : null
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "screen":
      return response.rendered
        ? `Session ${response.sessionId} output:\n${truncateText(response.rendered)}`
        : response.summary;
    case "wait":
      if (response.assistantText) {
        return `Session ${response.sessionId} assistant output:\n${truncateText(response.assistantText)}`;
      }

      if (response.rendered) {
        return `${response.summary}\n${truncateText(response.rendered)}`;
      }

      return response.summary;
    case "read":
      return response.summary;
    case "sys":
      return formatSystemSnapshot(response.snapshot);
    default:
      return response.summary ?? "Command completed.";
  }
}

export class AutomationAgent {
  constructor({
    config = defaultConfig,
    parser = new CommandParser(),
    repository = new InMemoryTaskRepository(),
    sessionRepository = new InMemorySessionRepository({
      maxBufferedLines: config.runtime.maxBufferedLines
    }),
    sourceBindingRepository = new InMemorySourceBindingRepository(),
    notifier = new InMemoryNotifier(),
    codexAdapter = createPreferredCodexAdapter(),
    systemAdapter = new DryRunSystemAdapter(),
    contextResolver = new ProjectContextResolver({
      projects: config.projects,
      allowedRoots: config.security.allowedProjectRoots
    }),
    policyEngine = new PolicyEngine(config.security)
  } = {}) {
    this.config = config;
    this.parser = parser;
    this.repository = repository;
    this.sessionRepository = sessionRepository;
    this.sourceBindingRepository = sourceBindingRepository;
    this.notifier = notifier;
    this.codexAdapter = codexAdapter;
    this.systemAdapter = systemAdapter;
    this.contextResolver = contextResolver;
    this.policyEngine = policyEngine;
    this.listSelections = new Map();
    this.projectSelections = new Map();
    this.fileBrowseStates = new Map();
  }

  #parseIncomingMessage(message) {
    const content = String(message?.content ?? "").trim();

    if (!content) {
      throw new CommandValidationError("Command text is required.", "command_empty");
    }

    if (content.startsWith("/")) {
      return this.parser.parse(content);
    }

    const sourceId = String(message?.sourceId ?? "").trim();
    const binding = this.sourceBindingRepository.getBinding(sourceId);

    if (!binding?.sessionId) {
      throw new CommandValidationError(
        "No active session is currently bound for this source. Use /create first, or send an explicit /send -n <sessionId> -m <prompt> command.",
        "session_not_bound",
        { sourceId }
      );
    }

    const session = this.sessionRepository.getSession(binding.sessionId);
    if (!session || !isSessionAvailableStatus(session.status)) {
      this.sourceBindingRepository.clearBinding(sourceId);
      throw new CommandValidationError(
        `The current session ${binding.sessionId} is no longer available. Create a new session or send /send -n <sessionId> -m <prompt>.`,
        "session_not_bound",
        {
          sourceId,
          sessionId: binding.sessionId
        }
      );
    }

    return {
      commandKey: "send",
      args: {
        n: binding.sessionId,
        m: content
      },
      raw: message.content,
      implicitPrompt: true
    };
  }

  #setActiveSessionBinding(sourceId, sessionId) {
    if (typeof sourceId !== "string" || sourceId.trim() === "") {
      return;
    }

    this.sourceBindingRepository.setBinding({ sourceId, sessionId });
  }

  #rememberListSelections(sourceId, selectionEntries) {
    if (typeof sourceId !== "string" || sourceId.trim() === "") {
      return;
    }

    const normalizedSourceId = sourceId.trim();
    const normalizedEntries = Array.isArray(selectionEntries)
      ? selectionEntries
          .map((entry) => ({
            index: Number(entry?.index ?? 0),
            type: entry?.type === "local" ? "local" : "managed",
            sessionId: entry?.sessionId ? String(entry.sessionId) : null,
            codexSessionId: entry?.codexSessionId ? String(entry.codexSessionId) : null
          }))
          .filter((entry) => Number.isInteger(entry.index) && entry.index > 0)
      : [];

    this.listSelections.set(normalizedSourceId, normalizedEntries);
  }

  #rememberProjectSelections(sourceId, selectionEntries) {
    if (typeof sourceId !== "string" || sourceId.trim() === "") {
      return;
    }

    const normalizedSourceId = sourceId.trim();
    const normalizedEntries = Array.isArray(selectionEntries)
      ? selectionEntries
          .map((entry) => ({
            index: Number(entry?.index ?? 0),
            projectRoot: entry?.projectRoot ? String(entry.projectRoot) : "",
            name: entry?.name ? String(entry.name) : ""
          }))
          .filter(
            (entry) =>
              Number.isInteger(entry.index) &&
              entry.index > 0 &&
              typeof entry.projectRoot === "string" &&
              entry.projectRoot !== ""
          )
      : [];

    this.projectSelections.set(normalizedSourceId, normalizedEntries);
  }

  #resolveProjectSelection(workspaceRef, sourceId) {
    const normalizedWorkspaceRef = String(workspaceRef ?? "").trim();
    if (!/^\d+$/.test(normalizedWorkspaceRef)) {
      return null;
    }

    const normalizedSourceId = String(sourceId ?? "").trim();
    const selectionEntries = normalizedSourceId ? this.projectSelections.get(normalizedSourceId) ?? [] : [];

    if (selectionEntries.length === 0) {
      throw new ContextResolutionError(
        `Numeric project selection "${normalizedWorkspaceRef}" is unavailable because there is no recent /projects result for this chat. Run /projects first.`,
        "project_selection_missing",
        { selection: normalizedWorkspaceRef }
      );
    }

    const entry = selectionEntries.find((candidate) => candidate.index === Number(normalizedWorkspaceRef));
    if (!entry) {
      throw new ContextResolutionError(
        `Numeric project selection "${normalizedWorkspaceRef}" is not present in the latest /projects result for this chat. Run /projects again.`,
        "project_selection_missing",
        { selection: normalizedWorkspaceRef }
      );
    }

    return structuredClone(entry);
  }

  #resolveNumberedSelection(targetRef, sourceId) {
    const normalizedTargetRef = String(targetRef ?? "").trim();
    if (!/^\d+$/.test(normalizedTargetRef)) {
      return null;
    }

    const normalizedSourceId = String(sourceId ?? "").trim();
    const selectionEntries = normalizedSourceId ? this.listSelections.get(normalizedSourceId) ?? [] : [];

    if (selectionEntries.length === 0) {
      throw new ContextResolutionError(
        `Numeric selection "${normalizedTargetRef}" is unavailable because there is no recent /list result for this chat. Run /list first.`,
        "list_selection_missing",
        { selection: normalizedTargetRef }
      );
    }

    const entry = selectionEntries.find((candidate) => candidate.index === Number(normalizedTargetRef));
    if (!entry) {
      throw new ContextResolutionError(
        `Numeric selection "${normalizedTargetRef}" is not present in the latest /list result for this chat. Run /list again or expand history with /list -a or /list -c <count>.`,
        "list_selection_missing",
        { selection: normalizedTargetRef }
      );
    }

    return structuredClone(entry);
  }

  #browseStateKey(sourceId, sessionId) {
    const normalizedSourceId = String(sourceId ?? "").trim();
    const normalizedSessionId = String(sessionId ?? "").trim();

    if (!normalizedSourceId || !normalizedSessionId) {
      return null;
    }

    return `${normalizedSourceId}::${normalizedSessionId}`;
  }

  #getBrowseState(sourceId, sessionId) {
    const stateKey = this.#browseStateKey(sourceId, sessionId);
    const state = stateKey ? this.fileBrowseStates.get(stateKey) : null;

    return state
      ? structuredClone(state)
      : {
          currentRelativePath: "",
          selectionEntries: [],
          mode: "ls",
          query: null
        };
  }

  #rememberBrowseState(sourceId, sessionId, browseState) {
    const stateKey = this.#browseStateKey(sourceId, sessionId);

    if (!stateKey) {
      return;
    }

    const normalizedEntries = Array.isArray(browseState?.selectionEntries)
      ? browseState.selectionEntries
          .map((entry) => ({
            index: Number(entry?.index ?? 0),
            type: entry?.type === "directory" ? "directory" : "file",
            name: entry?.name ? String(entry.name) : "",
            relativePath: entry?.relativePath ? String(entry.relativePath).replace(/\\/g, "/") : ""
          }))
          .filter(
            (entry) =>
              Number.isInteger(entry.index) &&
              entry.index > 0 &&
              typeof entry.relativePath === "string" &&
              entry.relativePath !== ""
          )
      : [];

    this.fileBrowseStates.set(stateKey, {
      currentRelativePath: String(browseState?.currentRelativePath ?? "").trim().replace(/\\/g, "/"),
      selectionEntries: normalizedEntries,
      mode: browseState?.mode === "find" ? "find" : "ls",
      query: browseState?.query ? String(browseState.query) : null
    });
  }

  #resolveBrowseSelection(targetRef, sourceId, sessionId) {
    const normalizedTargetRef = String(targetRef ?? "").trim();

    if (!/^\d+$/.test(normalizedTargetRef)) {
      return null;
    }

    const browseState = this.#getBrowseState(sourceId, sessionId);

    if (browseState.selectionEntries.length === 0) {
      throw new ContextResolutionError(
        `Numeric selection "${normalizedTargetRef}" is unavailable because there is no recent /ls or /find result for this chat. Run /ls or /find first.`,
        "browse_selection_missing",
        { selection: normalizedTargetRef }
      );
    }

    const entry = browseState.selectionEntries.find(
      (candidate) => candidate.index === Number(normalizedTargetRef)
    );

    if (!entry) {
      throw new ContextResolutionError(
        `Numeric selection "${normalizedTargetRef}" is not present in the latest /ls or /find result for this chat. Run /ls or /find again.`,
        "browse_selection_missing",
        { selection: normalizedTargetRef }
      );
    }

    return structuredClone(entry);
  }

  #clearBrowseStateForSession(sessionId) {
    const normalizedSessionId = String(sessionId ?? "").trim();

    if (!normalizedSessionId) {
      return;
    }

    for (const stateKey of this.fileBrowseStates.keys()) {
      const separatorIndex = stateKey.lastIndexOf("::");
      const keySessionId = separatorIndex >= 0 ? stateKey.slice(separatorIndex + 2) : "";

      if (keySessionId === normalizedSessionId) {
        this.fileBrowseStates.delete(stateKey);
      }
    }
  }

  #clearBindingsForSession(sessionId) {
    this.sourceBindingRepository.clearBindingsForSession(sessionId);
    this.#clearBrowseStateForSession(sessionId);
  }

  async receiveText(message) {
    const taskId = this.repository.nextTaskId();
    this.repository.createTask({ taskId, message });

    await this.notifier.send({
      taskId,
      phase: "command.received",
      sourceId: message.sourceId,
      message: `Received command from ${message.sourceId}.`
    });

    try {
      const parsedCommand = this.#parseIncomingMessage(message);
      this.repository.setParsedCommand(taskId, parsedCommand);

      this.policyEngine.authorizeSource({ message });
      this.policyEngine.authorizeShutdown(parsedCommand);

      const task = await this.#runCommand({ taskId, message, parsedCommand });
      return {
        ok: task.status === "completed",
        task,
        notifications: this.#notificationsForTask(taskId)
      };
    } catch (error) {
      const serialized = serializeError(error);
      const status = isRejectedError(error) ? "rejected" : "failed";
      const phase = status === "rejected" ? "command.rejected" : "command.failed";

      this.repository.addError(taskId, serialized);
      this.repository.setStatus(taskId, status, {
        resultSummary: serialized.message
      });
      this.repository.appendEvent(taskId, phase, {
        error: serialized
      });

      await this.notifier.send({
        taskId,
        phase,
        sourceId: message.sourceId,
        message: `${status === "rejected" ? "Command rejected" : "Command failed"}: ${serialized.message}`
      });

      const task = this.repository.getTask(taskId);
      return {
        ok: false,
        task,
        notifications: this.#notificationsForTask(taskId)
      };
    }
  }

  async #runCommand({ taskId, message, parsedCommand }) {
    const stepId = `${parsedCommand.commandKey}-${Date.now()}`;

    this.repository.setStatus(taskId, "running", {
      resultSummary: null
    });
    this.repository.appendEvent(taskId, "command.started", {
      commandKey: parsedCommand.commandKey
    });
    this.repository.addStep(taskId, {
      stepId,
      actionId: parsedCommand.commandKey,
      adapter: this.#adapterLabelForCommand(parsedCommand.commandKey),
      status: "running",
      startedAt: now(),
      result: null,
      error: null
    });

    await this.notifier.send({
      taskId,
      phase: "command.started",
      sourceId: message.sourceId,
      message: `Command ${parsedCommand.commandKey} started.`
    });

    try {
      const response = await this.#dispatchCommand(parsedCommand, message, taskId);
      const completionMessage = formatCommandResponseMessage(response);
      this.repository.completeStep(taskId, stepId, response);
      this.repository.setResponse(taskId, response);
      this.repository.setStatus(taskId, "completed", {
        resultSummary: completionMessage
      });
      this.repository.appendEvent(taskId, "command.completed", {
        commandKey: parsedCommand.commandKey
      });

      await this.notifier.send({
        taskId,
        phase: "command.completed",
        sourceId: message.sourceId,
        message: completionMessage,
        attachment: response?.attachment ?? null
      });

      return this.repository.getTask(taskId);
    } catch (error) {
      const serialized = serializeError(error);
      this.repository.failStep(taskId, stepId, serialized);
      throw error;
    }
  }

  async #dispatchCommand(parsedCommand, message, taskId) {
    switch (parsedCommand.commandKey) {
      case "create":
        return this.#handleCreate(parsedCommand.args, message);
      case "list":
        return this.#handleList(parsedCommand.args, message);
      case "projects":
        return this.#handleProjects(parsedCommand.args, message);
      case "ls":
        return this.#handleLs(parsedCommand.args, message);
      case "find":
        return this.#handleFind(parsedCommand.args, message);
      case "help":
        return this.#handleHelp();
      case "current":
        return this.#handleCurrent(message);
      case "activate":
        return this.#handleActivate(parsedCommand.args, message);
      case "send":
        return this.#handleSend(parsedCommand.args, message, taskId);
      case "read":
        return this.#handleRead(parsedCommand.args, message);
      case "screen":
        return this.#handleScreen(parsedCommand.args, message);
      case "wait":
        return this.#handleDeprecatedWait();
      case "kill":
        return this.#handleKill(parsedCommand.args, message);
      case "enablepermission":
        return this.#handleEnablePermission(parsedCommand.args, message);
      case "disablepermission":
        return this.#handleDisablePermission(parsedCommand.args, message);
      case "sys":
        return this.#handleSystemProbe();
      case "shutdown":
        return this.#handleShutdown(parsedCommand.args);
      case "cancel_shutdown":
        return this.#handleCancelShutdown();
      default:
        throw new ConfigurationError(
          `Unknown command "${parsedCommand.commandKey}".`,
          "command_unknown",
          { commandKey: parsedCommand.commandKey }
        );
    }
  }

  async #handleCreate(args, message) {
    const projectName = requireStringFlag(args, "n", "The -n flag is required for /create.");
    const rawWorkspaceRef = requireStringFlag(args, "w", "The -w flag is required for /create.");
    const projectSelection = this.#resolveProjectSelection(rawWorkspaceRef, message?.sourceId);
    const workspaceRef = projectSelection?.projectRoot ?? rawWorkspaceRef;
    const launchMode =
      args.mode === "foreground-debug" ? "foreground-debug" : this.config.runtime.defaultLaunchMode;
    const context = this.contextResolver.resolveProject({
      workspaceRef,
      projectName,
      launchMode
    });

    const sessionId = this.sessionRepository.nextSessionId();
    const session = this.sessionRepository.createSession({
      sessionId,
      ...context,
      permissionMode: this.config.runtime.defaultPermissionMode,
      status: "starting"
    });

    try {
      const launch = await this.codexAdapter.createSession({
        session,
        hooks: this.#sessionHooks(sessionId)
      });

      if (launch.output) {
        this.#appendAdapterOutput(sessionId, launch.output, "stdout");
      }

      if (launch.sessionStatus === "ready") {
        this.sessionRepository.markReady(sessionId, {
          pid: launch.pid ?? null,
          driver: launch.driver ?? null,
          codexThreadId: launch.codexThreadId ?? null,
          codexResumeMode: launch.codexResumeMode ?? null
        });
      } else {
        this.sessionRepository.markRunning(sessionId, {
          pid: launch.pid ?? null,
          driver: launch.driver ?? null,
          codexThreadId: launch.codexThreadId ?? null,
          codexResumeMode: launch.codexResumeMode ?? null
        });
      }
      this.#setActiveSessionBinding(message?.sourceId, sessionId);

      const snapshot = this.sessionRepository.getSession(sessionId);
      return {
        actionId: "create",
        summary: `Created session ${sessionId} for ${snapshot.projectName}.`,
        session: snapshot,
        launch
      };
    } catch (error) {
      this.sessionRepository.deleteSession(sessionId);
      throw error;
    }
  }

  async #handleActivate(args, message) {
    const session = await this.#resolveSendSession(args, message);

    if (!isSessionAvailableStatus(session.status)) {
      throw new ContextResolutionError(
        `Session ${session.sessionId} is not available for activation because it is in status "${session.status}".`,
        "session_not_available",
        {
          sessionId: session.sessionId,
          status: session.status
        }
      );
    }

    this.#setActiveSessionBinding(message?.sourceId, session.sessionId);

    return {
      actionId: "activate",
      summary: `Activated session ${session.sessionId} for ${session.projectName}. Plain text will now be sent there.`,
      session: this.sessionRepository.getSession(session.sessionId)
    };
  }

  async #handleList(args, message) {
    const sessions = this.sessionRepository.listSessions();
    const activeSessionId = this.sourceBindingRepository.getBinding(message?.sourceId)?.sessionId ?? null;
    const requestedHistoryCount = parseOptionalNonNegativeIntegerFlag(args, "c", "The -c flag must be a positive integer.");

    if (requestedHistoryCount === 0) {
      throw new CommandValidationError("The -c flag must be a positive integer.", "command_argument_invalid", { key: "c", value: args?.c });
    }

    const historyLimit = args?.a === true ? Number.MAX_SAFE_INTEGER : requestedHistoryCount ?? 8;
    let localListing = {
      conversations: [],
      totalCount: 0,
      stateDir: null,
      sessionIndexPath: null
    };
    let localCodexHistoryError = null;

    if (typeof this.codexAdapter.listLocalSessions === "function") {
      try {
        localListing = await this.codexAdapter.listLocalSessions();
      } catch (error) {
        localCodexHistoryError = serializeError(error).message;
      }
    }

    const indexedLocalConversations = Array.isArray(localListing?.conversations)
      ? localListing.conversations
      : [];
    const localConversationById = new Map(
      indexedLocalConversations.map((conversation) => [conversation.codexSessionId, conversation])
    );
    const managedSessions = sessions.map((session) => ({
      ...session,
      localConversation: session.codexThreadId
        ? localConversationById.get(session.codexThreadId) ?? null
        : null
    }));
    const attachedConversationIds = new Set(
      managedSessions
        .map((session) => session.codexThreadId)
        .filter((value) => typeof value === "string" && value.trim() !== "")
    );
    const unmatchedLocalCodexSessions = indexedLocalConversations.filter(
      (conversation) => !attachedConversationIds.has(conversation.codexSessionId)
    );
    const localCodexSessions = unmatchedLocalCodexSessions.slice(0, historyLimit);
    const omittedLocalCodexSessions = Math.max(0, unmatchedLocalCodexSessions.length - localCodexSessions.length);
    const selectionEntries = [];
    let selectionIndex = 1;

    for (const session of managedSessions) {
      selectionEntries.push({
        index: selectionIndex,
        type: "managed",
        sessionId: session.sessionId,
        codexSessionId: session.codexThreadId ?? null
      });
      selectionIndex += 1;
    }

    for (const conversation of localCodexSessions) {
      selectionEntries.push({
        index: selectionIndex,
        type: "local",
        sessionId: null,
        codexSessionId: conversation.codexSessionId
      });
      selectionIndex += 1;
    }

    this.#rememberListSelections(message?.sourceId, selectionEntries);
    const summary = localCodexHistoryError
      ? `Managed ${managedSessions.length} session(s); local Codex history unavailable.`
      : `Managed ${managedSessions.length} session(s); local Codex history ${unmatchedLocalCodexSessions.length} conversation(s).`;

    return {
      actionId: "list",
      summary,
      sessions: managedSessions,
      activeSessionId,
      localCodexSessions,
      totalManagedSessions: managedSessions.length,
      totalLocalCodexSessions: unmatchedLocalCodexSessions.length,
      omittedLocalCodexSessions,
      selectionEntries,
      localCodexHistoryError,
      localCodexStateDir: localListing?.stateDir ?? null,
      localCodexSessionIndexPath: localListing?.sessionIndexPath ?? null
    };
  }

  async #handleProjects(args, message) {
    const workspaceRef = typeof args.w === "string" && args.w.trim() !== "" ? args.w.trim() : undefined;
    const result = await this.contextResolver.listProjects({ workspaceRef });
    const renderedSections = [];
    const exampleProject = result.roots.find((root) => root.directories.length > 0)?.directories[0] ?? null;
    const selectionEntries = [];
    let selectionIndex = 1;

    for (const root of result.roots) {
      renderedSections.push(`Projects under ${root.rootPath} (${root.directories.length}):`);
      if (root.directories.length === 0) {
        renderedSections.push("- (none)");
        continue;
      }

      for (const project of root.directories) {
        selectionEntries.push({
          index: selectionIndex,
          projectRoot: project.projectRoot,
          name: project.name
        });
        renderedSections.push(`${selectionIndex}. ${project.name}`);
        selectionIndex += 1;
      }
    }

    this.#rememberProjectSelections(message?.sourceId, selectionEntries);

    if (exampleProject) {
      renderedSections.push(`Example: /create -n MyTask -w ${exampleProject.projectRoot}`);
      renderedSections.push("Quick create: /c MyTask 1");
    }
    const summary = `Projects (${result.totalProjectCount}) across ${result.totalRootCount} root(s).`;

    return {
      actionId: "projects",
      summary,
      rendered: renderedSections.join("\n"),
      workspaceRef: result.workspaceRef,
      configuredProjects: result.configuredProjects,
      roots: result.roots,
      selectionEntries,
      totalProjectCount: result.totalProjectCount,
      totalRootCount: result.totalRootCount
    };
  }

  #resolveBrowsePathReference(pathRef, message, session, browseState, commandKey) {
    const normalizedPathRef = typeof pathRef === "string" && pathRef.trim() !== "" ? pathRef.trim() : null;

    if (!normalizedPathRef) {
      return {
        pathRef: null,
        baseRelativePath: browseState.currentRelativePath ?? ""
      };
    }

    const browseSelection = this.#resolveBrowseSelection(
      normalizedPathRef,
      message?.sourceId,
      session.sessionId
    );

    if (!browseSelection) {
      return {
        pathRef: normalizedPathRef,
        baseRelativePath: browseState.currentRelativePath ?? ""
      };
    }

    if (browseSelection.type !== "directory") {
      throw new ContextResolutionError(
        commandKey === "ls"
          ? `Selection "${normalizedPathRef}" points to a file. Use /read -f ${normalizedPathRef} to download it.`
          : `Selection "${normalizedPathRef}" points to a file. Use /read -f ${normalizedPathRef} to download it, or choose a directory number for /find.`,
        "browse_selection_invalid",
        { selection: normalizedPathRef, type: browseSelection.type, commandKey }
      );
    }

    return {
      pathRef: browseSelection.relativePath,
      baseRelativePath: ""
    };
  }

  async #handleLs(args, message) {
    const session = this.#requireManagedSessionOrActiveBinding(args, message, "ls");
    const browseState = this.#getBrowseState(message?.sourceId, session.sessionId);
    const resolvedTarget = this.#resolveBrowsePathReference(
      args.p,
      message,
      session,
      browseState,
      "ls"
    );
    const result = await this.contextResolver.listDirectory(session, resolvedTarget);
    const selectionEntries = result.entries.map((entry, index) => ({
      index: index + 1,
      type: entry.type,
      name: entry.name,
      relativePath: entry.relativePath,
      sizeBytes: entry.sizeBytes ?? null
    }));

    this.#rememberBrowseState(message?.sourceId, session.sessionId, {
      currentRelativePath: result.directory.relativePath,
      selectionEntries,
      mode: "ls"
    });

    const renderedLines = [
      `Directory ${session.sessionId} @ ${formatBrowseRelativePath(result.directory.relativePath)}:`,
      ...(selectionEntries.length > 0
        ? selectionEntries.map((entry) => formatBrowseEntryLine(entry))
        : ["- (empty)"])
    ];

    if (result.omittedEntryCount > 0) {
      renderedLines.push(`- +${result.omittedEntryCount} more item(s) not shown.`);
    }

    renderedLines.push(
      "",
      "Use /ls -p <number|..|/> to browse directories.",
      "Use /read -f <number> to download a file from this list."
    );

    return {
      actionId: "ls",
      summary: `Listed ${selectionEntries.length} item(s) under ${formatBrowseRelativePath(result.directory.relativePath)}.`,
      sessionId: session.sessionId,
      directory: result.directory,
      entries: selectionEntries,
      totalEntryCount: result.totalEntryCount,
      omittedEntryCount: result.omittedEntryCount,
      rendered: renderedLines.join("\n")
    };
  }

  async #handleFind(args, message) {
    const session = this.#requireManagedSessionOrActiveBinding(args, message, "find");
    const query = requireStringFlag(args, "q", "The -q flag is required for /find.");
    const browseState = this.#getBrowseState(message?.sourceId, session.sessionId);
    const resolvedTarget = this.#resolveBrowsePathReference(
      args.p,
      message,
      session,
      browseState,
      "find"
    );
    const result = await this.contextResolver.findEntries(session, {
      query,
      ...resolvedTarget
    });
    const selectionEntries = result.entries.map((entry, index) => ({
      index: index + 1,
      type: entry.type,
      name: entry.name,
      relativePath: entry.relativePath,
      sizeBytes: entry.sizeBytes ?? null
    }));

    this.#rememberBrowseState(message?.sourceId, session.sessionId, {
      currentRelativePath: result.directory.relativePath,
      selectionEntries,
      mode: "find",
      query
    });

    const renderedLines = [
      `Matches for "${query}" under ${formatBrowseRelativePath(result.directory.relativePath)} (${selectionEntries.length}${result.limited ? "+" : ""}):`,
      ...(selectionEntries.length > 0
        ? selectionEntries.map((entry) => formatBrowseEntryLine(entry, { showRelativePath: true }))
        : ["- (none)"])
    ];

    if (result.limited) {
      renderedLines.push("- Result limit reached; refine the keyword or search from a narrower folder.");
    }

    renderedLines.push(
      "",
      "Use /ls -p <number> to open a directory from this result.",
      "Use /read -f <number> to download a file from this result."
    );

    return {
      actionId: "find",
      summary: `Found ${selectionEntries.length}${result.limited ? "+" : ""} match(es) under ${formatBrowseRelativePath(result.directory.relativePath)}.`,
      sessionId: session.sessionId,
      directory: result.directory,
      query,
      entries: selectionEntries,
      totalMatchCount: result.totalMatchCount,
      limited: result.limited,
      rendered: renderedLines.join("\n")
    };
  }

  async #handleSend(args, message, taskId = null) {
    const session = await this.#resolveSendSession(args, message);
    if (!isSessionAvailableStatus(session.status)) {
      throw new ContextResolutionError(
        `Session ${session.sessionId} is not available for prompts because it is in status "${session.status}".`,
        "session_not_available",
        {
          sessionId: session.sessionId,
          status: session.status
        }
      );
    }

    const prompt = requireStringFlag(args, "m", "The -m flag is required for /send.");
    const outputCursor = this.sessionRepository.getLatestOutputSequence(session.sessionId) ?? 0;
    const result = await this.codexAdapter.sendPrompt({
      session,
      prompt,
      hooks: this.#sessionHooks(session.sessionId)
    });

    if (result.sessionStatus === "ready") {
      this.sessionRepository.markReady(session.sessionId, {
        pid: result.pid ?? null,
        driver: result.driver ?? session.driver ?? null,
        codexThreadId: result.codexThreadId ?? session.codexThreadId ?? null,
        codexResumeMode: result.codexResumeMode ?? session.codexResumeMode ?? null
      });
    } else if (result.sessionStatus === "running" || result.pid) {
      this.sessionRepository.markRunning(session.sessionId, {
        pid: result.pid ?? null,
        driver: result.driver ?? session.driver ?? null,
        codexThreadId: result.codexThreadId ?? session.codexThreadId ?? null,
        codexResumeMode: result.codexResumeMode ?? session.codexResumeMode ?? null
      });
    }

    this.#appendAdapterOutput(session.sessionId, [`> ${prompt}`], "stdin");

    if (result.output) {
      this.#appendAdapterOutput(session.sessionId, result.output, "stdout");
    }

    this.#setActiveSessionBinding(message?.sourceId, session.sessionId);
    const followUpScreenCommand = `/screen -n ${session.sessionId} -c ${outputCursor}`;

    if (taskId) {
      this.repository.appendEvent(taskId, "command.screen_hint", {
        sessionId: session.sessionId,
        outputCursor,
        command: followUpScreenCommand
      });

      await this.notifier.send({
        taskId,
        phase: "command.screen_hint",
        sourceId: message?.sourceId,
        message: `screen: ${followUpScreenCommand}`
      });
    }

    const waitTimeoutMs =
      this.config.runtime.defaultSendWaitTimeoutMs ?? this.config.runtime.defaultWaitTimeoutMs;
    const waitResult = await this.#handleWait({
      n: session.sessionId,
      c: outputCursor,
      t: waitTimeoutMs
    });
    const snapshot = this.sessionRepository.getSession(session.sessionId);
    const shutdownEvaluation = await this.#evaluateArmedShutdown();
    const hasSettledAssistantReply =
      waitResult.status === "settled" && waitResult.completionState === "assistant_answer_detected";

    return {
      actionId: "send",
      summary: hasSettledAssistantReply
        ? `Prompt sent to session ${session.sessionId}; assistant reply completed.`
        : waitResult.assistantText
          ? `Prompt sent to session ${session.sessionId}; partial assistant output captured so far (${waitResult.status}, ${waitResult.completionState}).`
          : `Prompt sent to session ${session.sessionId}; no complete assistant reply yet (${waitResult.status}, ${waitResult.completionState}).`,
      session: snapshot,
      sessionStatus: waitResult.sessionStatus,
      outputCursor,
      latestCursor: waitResult.latestCursor,
      status: waitResult.status,
      completionState: waitResult.completionState,
      elapsedMs: waitResult.elapsedMs,
      meaningfulLineCount: waitResult.meaningfulLineCount,
      assistantLines: waitResult.assistantLines,
      assistantText: waitResult.assistantText,
      uiOnlyActivity: waitResult.uiOnlyActivity,
      classifications: waitResult.classifications,
      lines: waitResult.lines,
      rendered: waitResult.rendered,
      followUpScreenCommand,
      shutdownEvaluation
    };
  }

  async #handleRead(args, message) {
    const session = this.#requireManagedSessionOrActiveBinding(args, message, "read");
    const fileRef = requireStringFlag(args, "f", "The -f flag is required for /read.");
    const browseState = this.#getBrowseState(message?.sourceId, session.sessionId);
    const browseSelection = this.#resolveBrowseSelection(fileRef, message?.sourceId, session.sessionId);
    let pathRef = fileRef;
    let baseRelativePath = browseState.currentRelativePath ?? "";

    if (browseSelection) {
      if (browseSelection.type !== "file") {
        throw new ContextResolutionError(
          `Selection "${fileRef}" points to a directory. Use /ls -p ${fileRef} to open it, then choose a file number for /read.`,
          "browse_selection_invalid",
          { selection: fileRef, type: browseSelection.type, commandKey: "read" }
        );
      }

      pathRef = browseSelection.relativePath;
      baseRelativePath = "";
    }

    const fileRequest = this.contextResolver.resolveFileRequest(session, {
      pathRef,
      baseRelativePath
    });
    const result = await this.codexAdapter.readFile(fileRequest);

    return {
      actionId: "read",
      summary: result.summary,
      sessionId: session.sessionId,
      relativePath: result.relativePath,
      absolutePath: result.absolutePath,
      fileName: result.fileName,
      fileSizeBytes: result.fileSizeBytes,
      attachment: result.attachment ?? null
    };
  }

  async #handleScreen(args, message) {
    const session = this.#requireManagedSessionOrActiveBinding(args, message, "screen");
    const requestedLimit = args.l ? Number(args.l) : this.config.runtime.defaultScreenLines;
    const afterCursor = parseOptionalNonNegativeIntegerFlag(
      args,
      "c",
      "The -c flag must be a non-negative integer when used with /screen."
    );
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, this.config.runtime.maxBufferedLines)
        : this.config.runtime.defaultScreenLines;
    const lines =
      this.sessionRepository.getScreen(session.sessionId, {
        limit,
        afterSequence: afterCursor
      }) ?? [];
    const latestCursor = this.sessionRepository.getLatestOutputSequence(session.sessionId) ?? 0;

    return {
      actionId: "screen",
      summary:
        lines.length > 0
          ? `Showing ${lines.length} captured line(s) for ${session.sessionId}${
              afterCursor === null ? "" : ` since cursor ${afterCursor}`
            }.`
          : `Session ${session.sessionId} has no captured output${
              afterCursor === null ? " yet" : ` after cursor ${afterCursor} yet`
            }.`,
      sessionId: session.sessionId,
      afterCursor,
      latestCursor,
      lines,
      rendered: lines.map((entry) => `[${entry.stream}] ${entry.line}`).join("\n")
    };
  }

  #handleHelp() {
    return {
      actionId: "help",
      summary: "显示当前系统帮助。",
      rendered: buildHelpMessage(this.config)
    };
  }

  #handleCurrent(message) {
    const sourceId = String(message?.sourceId ?? "").trim();
    const binding = sourceId ? this.sourceBindingRepository.getBinding(sourceId) : null;
    let staleBindingCleared = false;
    let session = binding?.sessionId ? this.sessionRepository.getSession(binding.sessionId) : null;

    if (binding?.sessionId && !session && sourceId) {
      this.sourceBindingRepository.clearBinding(sourceId);
      staleBindingCleared = true;
    }

    const browseState = session
      ? this.#getBrowseState(sourceId, session.sessionId)
      : {
          currentRelativePath: "",
          selectionEntries: [],
          mode: "ls",
          query: null
        };
    const executionProfile =
      session?.permissionMode === "auto"
        ? this.config.runtime.autoPermissionExecProfile
        : this.config.runtime.defaultExecProfile;
    const sandboxMode =
      executionProfile === "dangerous" ? null : this.config.runtime.codexSandboxMode ?? null;

    return {
      actionId: "current",
      summary: session
        ? `Current active session is ${session.sessionId} (${session.projectName}).`
        : staleBindingCleared
          ? "The previous active session is no longer available and its stale binding was cleared."
          : "No active session is currently bound for this chat.",
      sourceId,
      session,
      staleBindingCleared,
      browseState,
      latestCursor: session ? this.sessionRepository.getLatestOutputSequence(session.sessionId) ?? 0 : 0,
      executionProfile,
      sandboxMode
    };
  }

  #handleDeprecatedWait() {
    throw new CommandValidationError(
      "The /wait command is no longer needed. /send now waits automatically; use /screen to inspect current output.",
      "command_deprecated",
      {
        commandKey: "wait"
      }
    );
  }

  async #handleWait(args) {
    const session = this.#requireSession(args);
    const afterCursor = parseOptionalNonNegativeIntegerFlag(
      args,
      "c",
      "The -c flag is required for /wait and must be a non-negative integer."
    );

    if (afterCursor === null) {
      throw new CommandValidationError(
        "The -c flag is required for /wait and must be a non-negative integer.",
        "command_argument_missing",
        { key: "c" }
      );
    }

    const idleMs =
      parseOptionalNonNegativeIntegerFlag(
        args,
        "i",
        "The -i flag must be a non-negative integer when used with /wait."
      ) ?? this.config.runtime.defaultWaitIdleMs;
    const timeoutMs =
      parseOptionalNonNegativeIntegerFlag(
        args,
        "t",
        "The -t flag must be a non-negative integer when used with /wait."
      ) ?? this.config.runtime.defaultWaitTimeoutMs;
    const pollMs =
      parseOptionalNonNegativeIntegerFlag(
        args,
        "p",
        "The -p flag must be a non-negative integer when used with /wait."
      ) ?? this.config.runtime.defaultWaitPollMs;

    const requestedLimit = args.l ? Number(args.l) : this.config.runtime.defaultScreenLines;
    const lineLimit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, this.config.runtime.maxBufferedLines)
        : this.config.runtime.defaultScreenLines;
    const startedAt = Date.now();
    let latestSession = this.sessionRepository.getSession(session.sessionId);
    let latestCursor = this.sessionRepository.getLatestOutputSequence(session.sessionId) ?? 0;
    let lastObservedActivityAt =
      latestCursor > afterCursor && latestSession?.lastActivityAt
        ? Date.parse(latestSession.lastActivityAt) || startedAt
        : startedAt;
    let status = "timeout";
    let fullAnalysis = analyzeCodexOutputLines([]);

    while (true) {
      latestSession = this.sessionRepository.getSession(session.sessionId);
      latestCursor = this.sessionRepository.getLatestOutputSequence(session.sessionId) ?? 0;
      const fullLines =
        this.sessionRepository.getScreen(session.sessionId, {
          limit: this.config.runtime.maxBufferedLines,
          afterSequence: afterCursor
        }) ?? [];
      fullAnalysis = analyzeCodexOutputLines(fullLines);

      if (latestSession?.lastActivityAt) {
        const activityAt = Date.parse(latestSession.lastActivityAt);
        if (Number.isFinite(activityAt) && activityAt > lastObservedActivityAt) {
          lastObservedActivityAt = activityAt;
        }
      }

      const elapsedMs = Date.now() - startedAt;
      const idleForMs = Date.now() - lastObservedActivityAt;
      const isActive = isSessionExecutionStatus(latestSession?.status);
      const requireExit = requiresProcessExitForWait(latestSession ?? session);

      if (!isActive) {
        status = fullAnalysis.hasMeaningfulOutput ? "settled" : "session_exited";
        break;
      }

      if (!requireExit && fullAnalysis.hasMeaningfulOutput && idleForMs >= idleMs) {
        status = "settled";
        break;
      }

      if (elapsedMs >= timeoutMs) {
        status = "timeout";
        break;
      }

      await delay(pollMs);
    }

    latestSession = this.sessionRepository.getSession(session.sessionId);
    latestCursor = this.sessionRepository.getLatestOutputSequence(session.sessionId) ?? 0;
    const elapsedMs = Date.now() - startedAt;
    const fullLines =
      this.sessionRepository.getScreen(session.sessionId, {
        limit: this.config.runtime.maxBufferedLines,
        afterSequence: afterCursor
      }) ?? [];
    fullAnalysis = analyzeCodexOutputLines(fullLines);
    const lines =
      this.sessionRepository.getScreen(session.sessionId, {
        limit: lineLimit,
        afterSequence: afterCursor
      }) ?? [];
    const completionState =
      fullAnalysis.hasMeaningfulOutput && status === "settled"
        ? "assistant_answer_detected"
        : fullAnalysis.uiOnlyActivity
          ? "ui_only_activity"
          : fullLines.length > 0
            ? "output_detected_without_answer"
            : "no_new_output";

    return {
      actionId: "wait",
      summary: `Wait for ${session.sessionId} finished with status ${status} (${completionState}).`,
      sessionId: session.sessionId,
      sessionStatus: latestSession?.status ?? null,
      afterCursor,
      latestCursor,
      status,
      completionState,
      elapsedMs,
      idleMs,
      timeoutMs,
      pollMs,
      meaningfulLineCount: fullAnalysis.meaningfulLineCount,
      assistantLines: fullAnalysis.assistantLines.map((entry) => entry.normalizedLine),
      assistantText: fullAnalysis.assistantText,
      uiOnlyActivity: fullAnalysis.uiOnlyActivity,
      classifications: fullAnalysis.lines.map((entry) => ({
        seq: entry.seq,
        kind: entry.kind,
        meaningful: entry.meaningful,
        normalizedLine: entry.normalizedLine
      })),
      lines,
      rendered: lines.map((entry) => `[${entry.stream}] ${entry.line}`).join("\n")
    };
  }

  async #handleKill(args, message) {
    const session = this.#requireSession(args, message);
    const result = await this.codexAdapter.killSession({ session });
    this.sessionRepository.markKilled(session.sessionId);
    this.#clearBindingsForSession(session.sessionId);
    const snapshot = this.sessionRepository.getSession(session.sessionId);
    const shutdownEvaluation = await this.#evaluateArmedShutdown();

    return {
      actionId: "kill",
      summary: result.summary,
      session: snapshot,
      shutdownEvaluation
    };
  }

  async #handleEnablePermission(args, message) {
    const session = this.#requireSession(args, message);
    this.sessionRepository.setPermissionMode(session.sessionId, "auto");
    const updatedSession = this.sessionRepository.getSession(session.sessionId);
    const adapterResult =
      typeof this.codexAdapter.enablePermission === "function"
        ? await this.codexAdapter.enablePermission({ session: updatedSession })
        : null;

    return {
      actionId: "enablePermission",
      summary: adapterResult?.summary ?? `Session ${session.sessionId} permission mode switched to auto.`,
      session: updatedSession,
      executionProfile: adapterResult?.executionProfile ?? null,
      sandboxMode: adapterResult?.sandboxMode ?? null
    };
  }

  async #handleDisablePermission(args, message) {
    const session = this.#requireSession(args, message);
    this.sessionRepository.setPermissionMode(session.sessionId, "manual");
    const updatedSession = this.sessionRepository.getSession(session.sessionId);
    const adapterResult =
      typeof this.codexAdapter.disablePermission === "function"
        ? await this.codexAdapter.disablePermission({ session: updatedSession })
        : null;

    return {
      actionId: "disablePermission",
      summary:
        adapterResult?.summary ?? `Session ${session.sessionId} permission mode switched to manual.`,
      session: updatedSession,
      executionProfile: adapterResult?.executionProfile ?? null,
      sandboxMode: adapterResult?.sandboxMode ?? null
    };
  }

  async #handleSystemProbe() {
    return this.systemAdapter.getSystemStatus({
      sessions: this.sessionRepository.listSessions()
    });
  }

  async #handleShutdown(args) {
    const activeSessions = this.sessionRepository.listActiveSessions();

    if (typeof args.a === "string") {
      const result = await this.systemAdapter.armShutdown({
        activeSessionCount: activeSessions.length
      });
      const shutdownEvaluation = await this.#evaluateArmedShutdown();

      return {
        ...result,
        shutdownEvaluation
      };
    }

    for (const session of activeSessions) {
      await this.codexAdapter.killSession({ session });
      this.sessionRepository.markKilled(session.sessionId);
      this.#clearBindingsForSession(session.sessionId);
    }

    return this.systemAdapter.shutdownNow({
      activeSessionCount: activeSessions.length
    });
  }

  async #handleCancelShutdown() {
    return this.systemAdapter.cancelShutdown();
  }

  #requireManagedSessionOrActiveBinding(args, message, commandKey) {
    if (typeof args?.n === "string" && args.n.trim() !== "") {
      return this.#requireSession(args, message);
    }

    const sourceId = String(message?.sourceId ?? "").trim();
    const binding = sourceId ? this.sourceBindingRepository.getBinding(sourceId) : null;

    if (!binding?.sessionId) {
      throw new CommandValidationError(
        `No active session is currently bound for this source. Use /activate first, or pass -n <sessionId> to /${commandKey}.`,
        "session_not_bound",
        { sourceId, commandKey }
      );
    }

    const session = this.sessionRepository.getSession(binding.sessionId);

    if (!session) {
      this.sourceBindingRepository.clearBinding(sourceId);
      throw new CommandValidationError(
        `The current session ${binding.sessionId} is no longer available. Use /list, /activate, or pass -n <sessionId> to /${commandKey}.`,
        "session_not_bound",
        { sourceId, sessionId: binding.sessionId, commandKey }
      );
    }

    return session;
  }

  async #resolveSendSession(args, message) {
    const targetRef =
      typeof args?.n === "string" && args.n.trim() !== ""
        ? args.n.trim()
        : null;

    if (!targetRef) {
      return this.#requireManagedSessionOrActiveBinding(args, message, "send");
    }

    const numberedSelection = this.#resolveNumberedSelection(targetRef, message?.sourceId);
    const resolvedTargetRef = numberedSelection
      ? numberedSelection.type === "managed"
        ? numberedSelection.sessionId
        : numberedSelection.codexSessionId
      : targetRef;
    const managedSession = this.sessionRepository.getSession(resolvedTargetRef);

    if (managedSession) {
      return managedSession;
    }

    const reusableAttachedSession = this.sessionRepository
      .listSessions()
      .find(
        (session) =>
          session.codexThreadId === resolvedTargetRef &&
          isSessionAvailableStatus(session.status)
      );

    if (reusableAttachedSession) {
      return reusableAttachedSession;
    }

    const localListing =
      typeof this.codexAdapter.listLocalSessions === "function"
        ? await this.codexAdapter.listLocalSessions()
        : { conversations: [] };
    const localConversation = Array.isArray(localListing?.conversations)
      ? localListing.conversations.find(
          (conversation) => conversation.codexSessionId === resolvedTargetRef
        )
      : null;

    if (!localConversation) {
      throw new ContextResolutionError(
        isLogicalSessionId(targetRef)
          ? `Unknown session "${targetRef}".`
          : `Unknown session or local Codex conversation "${targetRef}". Run /list first and use a displayed session id or Codex conversation id.`,
        "session_unknown",
        { sessionId: targetRef }
      );
    }

    const explicitWorkspaceRef =
      typeof args.w === "string" && args.w.trim() !== ""
        ? args.w.trim()
        : null;
    const activeBindingSessionId =
      this.sourceBindingRepository.getBinding(message?.sourceId)?.sessionId ?? null;
    const activeBindingSession = activeBindingSessionId
      ? this.sessionRepository.getSession(activeBindingSessionId)
      : null;
    const fallbackManagedSessions = this.sessionRepository.listSessions();
    const seedSession = explicitWorkspaceRef
      ? null
      : activeBindingSession ??
        (fallbackManagedSessions.length === 1 ? fallbackManagedSessions[0] : null);

    let context;
    if (explicitWorkspaceRef) {
      context = this.contextResolver.resolveProject({
        workspaceRef: explicitWorkspaceRef,
        launchMode: this.config.runtime.defaultLaunchMode
      });
    } else if (seedSession) {
      context = {
        workspaceAlias: seedSession.workspaceAlias ?? null,
        projectName: seedSession.projectName,
        projectRoot: seedSession.projectRoot,
        defaultFile: seedSession.defaultFile ?? null,
        launchMode: seedSession.launchMode ?? this.config.runtime.defaultLaunchMode
      };
    } else {
      throw new ContextResolutionError(
        `Codex conversation "${resolvedTargetRef}" is available locally, but no project workspace is currently selected. Create/select a project session first, or retry with -w <projectPath>.`,
        "workspace_missing_for_codex_conversation",
        { sessionId: targetRef }
      );
    }

    const sessionId = this.sessionRepository.nextSessionId();
    return this.sessionRepository.createSession({
      sessionId,
      ...context,
      permissionMode: this.config.runtime.defaultPermissionMode,
      driver: "exec-json",
      codexThreadId: resolvedTargetRef,
      codexResumeMode: null,
      status: "ready"
    });
  }

  #requireSession(args, message) {
    const targetRef = requireStringFlag(
      args,
      "n",
      "The -n flag is required and must reference a session id."
    );
    const numberedSelection = this.#resolveNumberedSelection(targetRef, message?.sourceId);

    if (numberedSelection) {
      if (numberedSelection.type === "local") {
        throw new ContextResolutionError(
          `Selection "${targetRef}" points to local Codex history, not a live managed session. Use /activate -n ${targetRef} or /send -n ${targetRef} -m <prompt> first.`,
          "session_unknown",
          { sessionId: targetRef, selectionType: "local" }
        );
      }

      const selectedSession = this.sessionRepository.getSession(numberedSelection.sessionId);
      if (!selectedSession) {
        throw new ContextResolutionError(
          `Selection "${targetRef}" is no longer available. Run /list again.`,
          "session_unknown",
          { sessionId: targetRef, selectionType: "managed" }
        );
      }

      return selectedSession;
    }

    const session = this.sessionRepository.getSession(targetRef);

    if (!session) {
      throw new ContextResolutionError(
        `Unknown session "${targetRef}".`,
        "session_unknown",
        { sessionId: targetRef }
      );
    }

    return session;
  }

  #appendAdapterOutput(sessionId, output, stream) {
    const lines = Array.isArray(output) ? output : [output];
    for (const line of lines) {
      this.sessionRepository.appendOutput(sessionId, {
        stream,
        content: line
      });
    }
  }

  #sessionHooks(sessionId) {
    return {
      onOutput: ({ stream, content }) => {
        this.sessionRepository.appendOutput(sessionId, { stream, content });
      },
      onMetadata: (metadata = {}) => {
        if (!this.sessionRepository.getSession(sessionId)) {
          return;
        }

        this.sessionRepository.updateSession(sessionId, metadata);
      },
      onExit: ({
        exitCode,
        signal,
        nextStatus = "exited",
        preserveBinding = false,
        metadata = {}
      }) => {
        const currentSession = this.sessionRepository.getSession(sessionId);
        if (!currentSession) {
          return;
        }

        if (nextStatus === "ready") {
          if (currentSession.status !== "killed") {
            this.sessionRepository.markReady(sessionId, {
              exitCode,
              signal,
              ...metadata
            });
          }
        } else {
          this.sessionRepository.markExited(sessionId, {
            exitCode,
            signal,
            status: nextStatus,
            ...metadata
          });
        }

        if (!preserveBinding) {
          this.#clearBindingsForSession(sessionId);
        }

        if (nextStatus !== "ready") {
          void this.notifier.send({
            taskId: null,
            phase: "session.exited",
            sourceId: "system",
            message: `Session ${sessionId} exited with code ${exitCode ?? "null"}${
              signal ? ` and signal ${signal}` : ""
            }.`
          });
        }

        void this.#evaluateArmedShutdown();
      }
    };
  }

  async #evaluateArmedShutdown() {
    const result = await this.systemAdapter.executeArmedShutdownIfReady({
      activeSessionCount: this.sessionRepository.listActiveSessions().length
    });

    if (result) {
      await this.notifier.send({
        taskId: null,
        phase: "system.shutdown.ready",
        sourceId: "system",
        message: result.summary
      });
    }

    return result;
  }

  #adapterLabelForCommand(commandKey) {
    if (["help", "current", "projects", "ls", "find", "read", "sys", "shutdown", "cancel_shutdown"].includes(commandKey)) {
      return "system";
    }

    return "codex";
  }

  #notificationsForTask(taskId) {
    return this.notifier.list().filter((notification) => notification.taskId === taskId);
  }
}

export function createDefaultAgent(overrides = {}) {
  return new AutomationAgent(overrides);
}
































