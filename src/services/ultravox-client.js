const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

class UltravoxClient {
  constructor({
    config,
    fetchImpl = globalThis.fetch,
    logger,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    if (!config) {
      throw new Error("UltravoxClient requires config");
    }

    if (!fetchImpl) {
      throw new Error("A fetch implementation is required for UltravoxClient");
    }

    this.config = config;
    this.fetch = fetchImpl;
    this.logger = logger;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async createInboundCall(metadata = {}) {
    const webhookCallback = {
      url: `${this.config.PUBLIC_BASE_URL}/webhooks/ultravox`,
      secrets: [this.config.ULTRAVOX_WEBHOOK_SECRET],
    };

    const enrichedMetadata = {
      ...metadata,
      toolsBaseUrl: `${this.config.PUBLIC_BASE_URL}/tools`,
      toolsApiKey: this.config.TOOLS_API_KEY,
    };

    const body = {
      medium: { twilio: {} },
      firstSpeakerSettings: { agent: {} },
      recordingEnabled: this.config.ULTRAVOX_RECORDING_ENABLED,
      joinTimeout: this.config.ULTRAVOX_JOIN_TIMEOUT,
      maxDuration: this.config.ULTRAVOX_MAX_DURATION,
      metadata: enrichedMetadata,
      callbacks: {
        joined: webhookCallback,
        ended: webhookCallback,
        billed: webhookCallback,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await this.fetch(
        `${this.config.ULTRAVOX_API_BASE_URL}/agents/${this.config.ULTRAVOX_AGENT_ID}/calls`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.config.ULTRAVOX_API_KEY,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error("Ultravox call creation failed");
        error.statusCode = response.status;
        error.responseBody = data;
        throw error;
      }

      return this.#parseCreateCallResponse(data);
    } finally {
      clearTimeout(timeout);
    }
  }

  #parseCreateCallResponse(data) {
    if (!data?.callId || !data?.joinUrl) {
      const error = new Error("Ultravox call creation response was missing callId or joinUrl");
      error.responseBody = data;
      throw error;
    }

    return data;
  }
}

module.exports = { UltravoxClient };
