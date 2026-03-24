import { AdapterExecutionError, ConfigurationError } from "./errors.js";

function buildUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function createExpiryTimestamp(expiresInSeconds) {
  const skewedSeconds = Math.max(0, Number(expiresInSeconds ?? 0) - 60);
  return Date.now() + skewedSeconds * 1000;
}

export class WeComAccessTokenProvider {
  constructor({
    corpId,
    corpSecret,
    fetchImpl = fetch,
    tokenEndpoint = "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
  } = {}) {
    if (!corpId) {
      throw new ConfigurationError("WeCom corpId is required.", "wecom_corpid_missing");
    }

    if (!corpSecret) {
      throw new ConfigurationError("WeCom corpSecret is required.", "wecom_corpsecret_missing");
    }

    this.corpId = corpId;
    this.corpSecret = corpSecret;
    this.fetchImpl = fetchImpl;
    this.tokenEndpoint = tokenEndpoint;
    this.cachedToken = null;
    this.expiresAt = 0;
  }

  async getAccessToken() {
    if (this.cachedToken && Date.now() < this.expiresAt) {
      return this.cachedToken;
    }

    const response = await this.fetchImpl(
      buildUrl(this.tokenEndpoint, {
        corpid: this.corpId,
        corpsecret: this.corpSecret
      })
    );

    if (!response.ok) {
      throw new AdapterExecutionError(
        `WeCom access token request failed with HTTP ${response.status}.`,
        "wecom_token_http_failed",
        { status: response.status }
      );
    }

    const payload = await response.json();

    if (payload.errcode !== 0 || !payload.access_token) {
      throw new AdapterExecutionError(
        `WeCom access token request failed: ${payload.errmsg ?? "Unknown error"}`,
        "wecom_token_request_failed",
        payload
      );
    }

    this.cachedToken = payload.access_token;
    this.expiresAt = createExpiryTimestamp(payload.expires_in);
    return this.cachedToken;
  }
}

export class WeComClient {
  constructor({
    agentId,
    tokenProvider,
    fetchImpl = fetch,
    messageEndpoint = "https://qyapi.weixin.qq.com/cgi-bin/message/send"
  } = {}) {
    if (!agentId) {
      throw new ConfigurationError("WeCom agentId is required.", "wecom_agentid_missing");
    }

    if (!tokenProvider) {
      throw new ConfigurationError(
        "WeCom tokenProvider is required.",
        "wecom_token_provider_missing"
      );
    }

    this.agentId = agentId;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
    this.messageEndpoint = messageEndpoint;
  }

  async sendTextMessage({ touser, toparty = "", totag = "", content, safe = 0 }) {
    if (!touser && !toparty && !totag) {
      throw new AdapterExecutionError(
        "WeCom sendTextMessage requires touser, toparty, or totag.",
        "wecom_message_target_missing"
      );
    }

    const accessToken = await this.tokenProvider.getAccessToken();
    const response = await this.fetchImpl(
      buildUrl(this.messageEndpoint, { access_token: accessToken }),
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          touser,
          toparty,
          totag,
          msgtype: "text",
          agentid: this.agentId,
          text: {
            content
          },
          safe
        })
      }
    );

    if (!response.ok) {
      throw new AdapterExecutionError(
        `WeCom send message failed with HTTP ${response.status}.`,
        "wecom_message_http_failed",
        { status: response.status }
      );
    }

    const payload = await response.json();

    if (payload.errcode !== 0) {
      throw new AdapterExecutionError(
        `WeCom send message failed: ${payload.errmsg ?? "Unknown error"}`,
        "wecom_message_send_failed",
        payload
      );
    }

    return payload;
  }
}
