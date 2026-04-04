import fs from "node:fs/promises";
import path from "node:path";
import { Blob } from "node:buffer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AdapterExecutionError, ConfigurationError } from "./errors.js";

const execFileAsync = promisify(execFile);

function normalizeApiBaseUrl(apiBaseUrl) {
  return String(apiBaseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
}

function normalizeChatId(chatId) {
  const value = String(chatId ?? "").trim();
  if (!value) {
    throw new ConfigurationError("Telegram chat id is required.", "telegram_chat_id_missing");
  }

  if (/^-?\d+$/.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }

  return value;
}

function shouldFallbackToPowerShell(error) {
  const causeCode = error?.cause?.code ?? null;
  const message = String(error?.message ?? "");
  return process.platform === "win32" && (causeCode === "EACCES" || message.includes("fetch failed"));
}

function escapeForPowerShellHereString(value) {
  return String(value ?? "").replace(/'@/g, "'@@");
}

function normalizeCaption(caption, maxLength = 1024) {
  const text = String(caption ?? "").trim();
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatPowerShellDiagnostic(value, maxLength = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();

  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".mdx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".xml",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".java",
  ".kt",
  ".kts",
  ".gradle",
  ".properties",
  ".py",
  ".rb",
  ".php",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".sql",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".log",
  ".rst"
]);

const TEXT_ATTACHMENT_BASENAMES = new Set([
  "readme",
  "license",
  "changelog",
  "dockerfile",
  ".gitignore",
  ".npmrc",
  ".editorconfig"
]);

function isLikelyTextAttachment(filePath, fileName = null) {
  const targetName = String(fileName ?? path.basename(String(filePath ?? ""))).trim().toLowerCase();
  if (!targetName) {
    return false;
  }

  const extension = path.extname(targetName);
  if (extension && TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    return true;
  }

  if (!extension && TEXT_ATTACHMENT_BASENAMES.has(targetName)) {
    return true;
  }

  return false;
}
function buildPowerShellTransportScript({ url, body }) {
  if (body?.kind === "document") {
    const textUpload = "true";
    return `
$ProgressPreference='SilentlyContinue'
$ErrorActionPreference='Stop'
$uri = @'
${escapeForPowerShellHereString(url)}
'@
$chatId = @'
${escapeForPowerShellHereString(String(body.chatId ?? ""))}
'@
$filePath = @'
${escapeForPowerShellHereString(String(body.filePath ?? ""))}
'@
$fileName = @'
${escapeForPowerShellHereString(String(body.fileName ?? ""))}
'@
$caption = @'
${escapeForPowerShellHereString(String(body.caption ?? ""))}
'@
$textUpload = @'
${escapeForPowerShellHereString(textUpload)}
'@
try {
  $responseText = ''
  $transportErrors = @()
  if ($textUpload -eq 'true') {
    try {
      Add-Type -AssemblyName System.Net.Http
      $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
      $httpClient = New-Object System.Net.Http.HttpClient
      $multipart = New-Object System.Net.Http.MultipartFormDataContent
      $chatIdContent = New-Object System.Net.Http.StringContent -ArgumentList @([string]$chatId, [System.Text.Encoding]::UTF8)
      $multipart.Add($chatIdContent, 'chat_id')
      if ($caption) {
        $captionContent = New-Object System.Net.Http.StringContent -ArgumentList @([string]$caption, [System.Text.Encoding]::UTF8)
        $multipart.Add($captionContent, 'caption')
      }
      $documentContent = New-Object System.Net.Http.ByteArrayContent -ArgumentList (,$fileBytes)
      $documentContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/octet-stream')
      $multipart.Add($documentContent, 'document', $fileName)
      $response = $httpClient.PostAsync($uri, $multipart).GetAwaiter().GetResult()
      $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if (-not $response.IsSuccessStatusCode) {
        throw ('HTTP ' + [int]$response.StatusCode + ' ' + [string]$response.ReasonPhrase + ': ' + [string]$responseText)
      }
    } catch {
      $transportErrors += ('text-multipart=' + [string]($_.Exception.Message))
      $responseText = ''
    }
  }
  if ([string]::IsNullOrWhiteSpace([string]$responseText)) {
    $curlCandidates = @(Get-Command curl.exe -All -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source | Select-Object -Unique)
    if ($curlCandidates.Count -eq 0) { $curlCandidates = @('curl.exe') }
    foreach ($curlPath in $curlCandidates) {
      foreach ($networkFlag in @('-4', '')) {
        $arguments = @('-sS', '-X', 'POST')
        if ($networkFlag) { $arguments += $networkFlag }
        $arguments += $uri
        $arguments += '--form-string'; $arguments += ('chat_id=' + $chatId)
        if ($caption) { $arguments += '--form-string'; $arguments += ('caption=' + $caption) }
        $arguments += '-F'
        $arguments += ('document=@' + $filePath + ';filename=' + $fileName)
        $curlOutput = & $curlPath @arguments 2>&1
        $curlText = ($curlOutput | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and $curlText) {
          $responseText = $curlText
          break
        }
        $transportErrors += (($curlPath + ' ' + $networkFlag + ': ' + $curlText).Trim())
      }
      if ($responseText) { break }
    }
  }
  if ([string]::IsNullOrWhiteSpace([string]$responseText)) {
    if ($transportErrors.Count -gt 0) { throw ($transportErrors -join ' | ') }
    throw 'Telegram PowerShell document transport produced an empty response.'
  }
  $responseBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$responseText)
  [Convert]::ToBase64String($responseBytes)
} catch {
  [Console]::Error.WriteLine([string]($_.Exception.Message))
  exit 1
}`;
  }

  return `
$ProgressPreference='SilentlyContinue'
$ErrorActionPreference='Stop'
$uri = @'
${escapeForPowerShellHereString(url)}
'@
$json = @'
${escapeForPowerShellHereString(JSON.stringify(body))}
'@
try {
  $requestBody = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $requestBody
  $responseJson = $response | ConvertTo-Json -Depth 20 -Compress
  $responseBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$responseJson)
  [Convert]::ToBase64String($responseBytes)
} catch {
  [Console]::Error.WriteLine([string]($_.Exception.Message))
  exit 1
}`;
}
function parsePowerShellTransportOutput(stdout, stderr = "") {
  const raw = String(stdout ?? "").trim();
  const stderrSummary = formatPowerShellDiagnostic(stderr);

  if (!raw) {
    throw new AdapterExecutionError(
      stderrSummary
        ? `Telegram PowerShell transport returned an empty payload. ${stderrSummary}`
        : "Telegram PowerShell transport returned an empty payload.",
      "telegram_powershell_transport_failed",
      stderrSummary ? { stderr: stderrSummary } : {}
    );
  }

  const jsonText = raw.startsWith("{") || raw.startsWith("[")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new AdapterExecutionError(
      stderrSummary
        ? `Telegram PowerShell transport returned unreadable JSON: ${error?.message ?? "Unknown error."} ${stderrSummary}`
        : `Telegram PowerShell transport returned unreadable JSON: ${error?.message ?? "Unknown error."}`,
      "telegram_powershell_transport_failed",
      stderrSummary ? { stderr: stderrSummary } : {}
    );
  }
}

async function parseApiResponse(method, response) {
  if (!response?.ok) {
    throw new AdapterExecutionError(
      `Telegram API ${method} request failed with status ${response?.status ?? "unknown"}.`,
      "telegram_http_error",
      {
        method,
        status: response?.status ?? null
      }
    );
  }

  const result = await response.json();

  if (!result?.ok) {
    throw new AdapterExecutionError(
      `Telegram API ${method} failed: ${result?.description ?? "Unknown error."}`,
      "telegram_api_error",
      {
        method,
        errorCode: result?.error_code ?? null,
        description: result?.description ?? null
      }
    );
  }

  return result.result;
}

export function createPowerShellRunner({ execFileImpl = execFileAsync } = {}) {
  return async function powershellRunner({ url, body }) {
    const script = buildPowerShellTransportScript({ url, body });

    try {
      const { stdout, stderr } = await execFileImpl(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 10
        }
      );
      return parsePowerShellTransportOutput(stdout, stderr);
    } catch (error) {
      if (error instanceof AdapterExecutionError) {
        throw error;
      }

      const stderrSummary = formatPowerShellDiagnostic(error?.stderr);
      const stdoutSummary = formatPowerShellDiagnostic(error?.stdout);
      const diagnostic = stderrSummary || stdoutSummary || "";

      throw new AdapterExecutionError(
        diagnostic
          ? `Telegram PowerShell transport failed: ${diagnostic}`
          : `Telegram PowerShell transport failed: ${error?.message ?? "Unknown error."}`,
        "telegram_powershell_transport_failed",
        {
          stderr: stderrSummary || null,
          stdout: stdoutSummary || null
        }
      );
    }
  };
}

const defaultPowerShellRunner = createPowerShellRunner();

export class TelegramBotClient {
  constructor({
    botToken,
    apiBaseUrl = "https://api.telegram.org",
    fetchImpl = globalThis.fetch,
    transport = "auto",
    powershellRunner = defaultPowerShellRunner
  } = {}) {
    if (!botToken) {
      throw new ConfigurationError("Telegram bot token is required.", "telegram_bot_token_missing");
    }

    if (transport !== "powershell" && typeof fetchImpl !== "function") {
      throw new ConfigurationError(
        "A fetch implementation is required for Telegram client operations.",
        "telegram_fetch_missing"
      );
    }

    this.botToken = botToken;
    this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
    this.fetchImpl = fetchImpl;
    this.transport = transport;
    this.powershellRunner = powershellRunner;
  }

  async getUpdates({ offset = 0, timeout = 20, limit = 100, allowedUpdates = ["message"] } = {}) {
    return this.#callApi("getUpdates", {
      offset,
      timeout,
      limit,
      allowed_updates: allowedUpdates
    });
  }

  async sendMessage({ chatId, text, disableWebPagePreview = true } = {}) {
    return this.#callApi("sendMessage", {
      chat_id: normalizeChatId(chatId),
      text: String(text ?? ""),
      disable_web_page_preview: disableWebPagePreview
    });
  }

  async setMyCommands({ commands = [], scope = null, languageCode = null } = {}) {
    const normalizedCommands = Array.isArray(commands)
      ? commands
          .map((entry) => ({
            command: String(entry?.command ?? "").trim(),
            description: String(entry?.description ?? "").trim()
          }))
          .filter((entry) => entry.command !== "" && entry.description !== "")
      : [];

    return this.#callApi("setMyCommands", {
      commands: normalizedCommands,
      ...(scope ? { scope } : {}),
      ...(languageCode ? { language_code: languageCode } : {})
    });
  }

  async sendDocument({ chatId, filePath, fileName = null, caption = "" } = {}) {
    const normalizedPath = String(filePath ?? "").trim();
    if (!normalizedPath) {
      throw new ConfigurationError(
        "Telegram document file path is required.",
        "telegram_document_path_missing"
      );
    }

    const resolvedChatId = normalizeChatId(chatId);
    const resolvedFileName = String(fileName ?? "").trim() || path.basename(normalizedPath);
    const resolvedCaption = normalizeCaption(caption);
    const url = `${this.apiBaseUrl}/bot${this.botToken}/sendDocument`;

    if (this.transport === "powershell") {
      return this.#callViaPowerShell("sendDocument", url, {
        kind: "document",
        chatId: resolvedChatId,
        filePath: normalizedPath,
        fileName: resolvedFileName,
        caption: resolvedCaption,
        textUpload: isLikelyTextAttachment(normalizedPath, resolvedFileName)
      });
    }

    let fileBytes;
    try {
      fileBytes = await fs.readFile(normalizedPath);
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to read Telegram document "${normalizedPath}": ${error?.message ?? "Unknown error."}`,
        "telegram_document_read_failed",
        { filePath: normalizedPath }
      );
    }

    const form = new FormData();
    form.set("chat_id", String(resolvedChatId));
    if (resolvedCaption) {
      form.set("caption", resolvedCaption);
    }
    form.set("document", new Blob([fileBytes]), resolvedFileName);

    return this.#callMultipartApi("sendDocument", form, {
      kind: "document",
      chatId: resolvedChatId,
      filePath: normalizedPath,
      fileName: resolvedFileName,
      caption: resolvedCaption,
      textUpload: isLikelyTextAttachment(normalizedPath, resolvedFileName)
    });
  }

  async #callApi(method, payload) {
    const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`;

    if (this.transport === "powershell") {
      return this.#callViaPowerShell(method, url, payload);
    }

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      return parseApiResponse(method, response);
    } catch (error) {
      if (this.transport === "auto" && shouldFallbackToPowerShell(error)) {
        return this.#callViaPowerShell(method, url, payload);
      }

      if (error instanceof AdapterExecutionError) {
        throw error;
      }

      throw new AdapterExecutionError(
        `Telegram API ${method} request failed: ${error?.message ?? "Unknown error."}`,
        "telegram_http_error",
        {
          method,
          causeCode: error?.cause?.code ?? null
        }
      );
    }
  }

  async #callMultipartApi(method, body, powershellBody) {
    const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`;

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        body
      });

      return parseApiResponse(method, response);
    } catch (error) {
      if (this.transport === "auto" && shouldFallbackToPowerShell(error)) {
        return this.#callViaPowerShell(method, url, powershellBody);
      }

      if (error instanceof AdapterExecutionError) {
        throw error;
      }

      throw new AdapterExecutionError(
        `Telegram API ${method} request failed: ${error?.message ?? "Unknown error."}`,
        "telegram_http_error",
        {
          method,
          causeCode: error?.cause?.code ?? null
        }
      );
    }
  }

  async #callViaPowerShell(method, url, payload) {
    const result = await this.powershellRunner({ url, body: payload, method });

    if (!result?.ok) {
      throw new AdapterExecutionError(
        `Telegram API ${method} failed: ${result?.description ?? "Unknown error."}`,
        "telegram_api_error",
        {
          method,
          errorCode: result?.error_code ?? null,
          description: result?.description ?? null
        }
      );
    }

    return result.result;
  }
}
