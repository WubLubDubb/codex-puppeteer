function normalizeDecoratedLine(line) {
  return String(line ?? "")
    .replace(/^[\s\u2500-\u257f]+/g, "")
    .replace(/[\s\u2500-\u257f]+$/g, "")
    .trim();
}

function isBoxDrawingLine(line) {
  return /^[\s\u2500-\u257f]+$/.test(String(line ?? ""));
}

function isPromptEcho(text) {
  return /^(?:[>?\u203a\u276f\u00bb][_\s]*|\/\w+\b|you:\s+)/i.test(text);
}

function isUiStatusLine(text) {
  return [
    /\b(?:gpt-[\w.-]+|xhigh|high|medium|low)\b/i,
    /\b(?:approval|sandbox|cwd|model|terminal|session|tokens?|directory)\b\s*:/i,
    /^(?:thinking|working|running)(?:\.\.\.)?$/i,
    /press enter to continue/i,
    /trust the contents of this directory/i,
    /(?:ctrl\+c|ctrl-c|esc|shift\+tab|↑↓|\/help)/i,
    /^openai codex\b/i,
    /^tip\s*:/i
  ].some((pattern) => pattern.test(text));
}

export function classifyCodexOutputLine(entry) {
  const stream = entry?.stream ?? "stdout";
  const rawLine = String(entry?.line ?? "");
  const trimmed = rawLine.trim();
  const normalized = normalizeDecoratedLine(rawLine);

  if (stream === "stdin") {
    return {
      kind: "user_prompt",
      meaningful: false,
      normalizedLine: normalized || trimmed
    };
  }

  if (!trimmed) {
    return {
      kind: "blank",
      meaningful: false,
      normalizedLine: ""
    };
  }

  if (isBoxDrawingLine(trimmed) || !normalized) {
    return {
      kind: "ui_box",
      meaningful: false,
      normalizedLine: normalized
    };
  }

  if (isPromptEcho(trimmed) || isPromptEcho(normalized)) {
    return {
      kind: "prompt_echo",
      meaningful: false,
      normalizedLine: normalized
    };
  }

  if (isUiStatusLine(normalized)) {
    return {
      kind: "ui_status",
      meaningful: false,
      normalizedLine: normalized
    };
  }

  return {
    kind: "assistant_output",
    meaningful: true,
    normalizedLine: normalized
  };
}

export function analyzeCodexOutputLines(lines = []) {
  const classifiedLines = lines.map((entry) => {
    const classification = classifyCodexOutputLine(entry);
    return {
      seq: entry?.seq ?? null,
      stream: entry?.stream ?? "stdout",
      line: entry?.line ?? "",
      at: entry?.at ?? null,
      ...classification
    };
  });

  const assistantLines = classifiedLines.filter((entry) => entry.meaningful);
  const uiOnlyLineCount = classifiedLines.filter((entry) => !entry.meaningful).length;

  return {
    totalLines: classifiedLines.length,
    meaningfulLineCount: assistantLines.length,
    uiOnlyLineCount,
    hasMeaningfulOutput: assistantLines.length > 0,
    uiOnlyActivity: assistantLines.length === 0 && classifiedLines.length > 0,
    assistantLines,
    assistantText: assistantLines.map((entry) => entry.normalizedLine).join("\n"),
    lines: classifiedLines
  };
}
