const { config } = require("../config");

class UltravoxClient {
  constructor(logger) {
    this.logger = logger;
  }

  async createInboundCall(metadata = {}) {
    const body = {
      medium: { twilio: {} },
      firstSpeakerSettings: { agent: {} },
      recordingEnabled: config.ULTRAVOX_RECORDING_ENABLED,
      joinTimeout: config.ULTRAVOX_JOIN_TIMEOUT,
      maxDuration: config.ULTRAVOX_MAX_DURATION,
      metadata,
      callbacks: {
        joined: {
          url: `${config.PUBLIC_BASE_URL}/webhooks/ultravox`,
          secrets: [config.ULTRAVOX_WEBHOOK_SECRET],
        },
        ended: {
          url: `${config.PUBLIC_BASE_URL}/webhooks/ultravox`,
          secrets: [config.ULTRAVOX_WEBHOOK_SECRET],
        },
        billed: {
          url: `${config.PUBLIC_BASE_URL}/webhooks/ultravox`,
          secrets: [config.ULTRAVOX_WEBHOOK_SECRET],
        },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`${config.ULTRAVOX_API_BASE_URL}/agents/${config.ULTRAVOX_AGENT_ID}/calls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.ULTRAVOX_API_KEY,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error("Ultravox call creation failed");
        error.statusCode = response.status;
        error.responseBody = data;
        throw error;
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { UltravoxClient };
