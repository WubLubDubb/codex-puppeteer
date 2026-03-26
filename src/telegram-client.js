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

function buildPowerShellTransportScript({ url, body }) {
  if (body?.kind === "document") {
    return [
      "$ProgressPreference='SilentlyContinue'",
      "$uri = @'",
      escapeForPowerShellHereString(url),
      "'@",
      "$chatId = @'",
      escapeForPowerShellHereString(String(body.chatId ?? "")),
      "'@",
      "$filePath = @'",
      escapeForPowerShellHereString(String(body.filePath ?? "")),
      "'@",
      "$fileName = @'",
      escapeForPowerShellHereString(String(body.fileName ?? "")),
      "'@",
      "$caption = @'",
      escapeForPowerShellHereString(String(body.caption ?? "")),
      "'@",
      "$client = [System.Net.Http.HttpClient]::new()",
      "$multipart = [System.Net.Http.MultipartFormDataContent]::new()",
      "$multipart.Add([System.Net.Http.StringContent]::new($chatId), 'chat_id')",
      "if ($caption) { $multipart.Add([System.Net.Http.StringContent]::new($caption, [System.Text.Encoding]::UTF8), 'caption') }",
      "$fileBytes = [System.IO.File]::ReadAllBytes($filePath)",
      "$fileContent = [System.Net.Http.ByteArrayContent]::new($fileBytes)",
      "$multipart.Add($fileContent, 'document', $fileName)",
      "$response = $client.PostAsync($uri, $multipart).GetAwaiter().GetResult()",
      "$responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()",
      "$responseBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$responseText)",
      "[Convert]::ToBase64String($responseBytes)"
    ].join("\n");
  }

  return [
    "$ProgressPreference='SilentlyContinue'",
    "$uri = @'",
    escapeForPowerShellHereString(url),
    "'@",
    "$json = @'",
    escapeForPowerShellHereString(JSON.stringify(body)),
    "'@",
    "$requestBody = [System.Text.Encoding]::UTF8.GetBytes($json)",
    "$response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $requestBody",
    "$responseJson = $response | ConvertTo-Json -Depth 20 -Compress",
    "$responseBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$responseJson)",
    "[Convert]::ToBase64String($responseBytes)"
  ].join("\n");
}

function parsePowerShellTransportOutput(stdout) {
  const raw = String(stdout ?? "").trim();

  if (!raw) {
    throw new AdapterExecutionError(
      "Telegram PowerShell transport returned an empty payload.",
      "telegram_powershell_transport_failed"
    );
  }

  const jsonText = raw.startsWith("{") || raw.startsWith("[")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new AdapterExecutionError(
      `Telegram PowerShell transport returned unreadable JSON: ${error?.message ?? "Unknown error."}`,
      "telegram_powershell_transport_failed"
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
      const { stdout } = await execFileImpl(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 10
        }
      );
      return parsePowerShellTransportOutput(stdout);
    } catch (error) {
      if (error instanceof AdapterExecutionError) {
        throw error;
      }

      throw new AdapterExecutionError(
        `Telegram PowerShell transport failed: ${error?.message ?? "Unknown error."}`,
        "telegram_powershell_transport_failed"
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
        caption: resolvedCaption
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
      caption: resolvedCaption
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
