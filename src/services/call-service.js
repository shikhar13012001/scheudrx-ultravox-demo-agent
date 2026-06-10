const twilio = require("twilio");

class CallService {
  constructor({ repository, ultravoxClient, logger }) {
    this.repository = repository;
    this.ultravoxClient = ultravoxClient;
    this.logger = logger;
    this.pendingInboundCalls = new Map();
  }

  async handleInboundTwilioWebhook(payload) {
    console.log("Received Twilio webhook:", payload);
    const callSid = payload.CallSid;
    if (!callSid) {
      throw new Error("Missing CallSid in Twilio inbound request");
    }

    const existing = await this.repository.getByTwilioCallSid(callSid);
    if (existing?.ultravox?.joinUrl) {
      return this.#buildConnectTwiml(existing.ultravox.joinUrl);
    }

    const pending = this.pendingInboundCalls.get(callSid);
    if (pending) {
      return pending;
    }

    const task = this.#createAndBridgeCall(payload);
    this.pendingInboundCalls.set(callSid, task);

    try {
      return await task;
    } finally {
      this.pendingInboundCalls.delete(callSid);
    }
  }

  async recordTwilioStatus(payload) {
    return this.repository.appendTwilioStatusEvent(payload.CallSid, payload);
  }

  async recordUltravoxCallback(payload) {
    const callId = payload?.call?.callId;
    if (!callId) {
      return null;
    }

    return this.repository.appendUltravoxEvent(callId, payload);
  }

  async #createAndBridgeCall(payload) {
    let record = await this.repository.getByTwilioCallSid(payload.CallSid);
    if (!record) {
      record = await this.repository.createIncomingTwilioCall(payload);
    }

    try {
      const ultravoxCall = await this.ultravoxClient.createInboundCall({
        localCallId: record.localCallId,
        twilioCallSid: payload.CallSid,
        twilioFrom: payload.From || "",
        twilioTo: payload.To || "",
      });

      record.state = "bridging";
      record.ultravox.callId = ultravoxCall.callId;
      record.ultravox.joinUrl = ultravoxCall.joinUrl;
      record.ultravox.status = "created";

      await this.repository.save(record);
      return this.#buildConnectTwiml(ultravoxCall.joinUrl);
    } catch (error) {
      record.state = "failed";
      record.lastError = {
        message: error.message,
        statusCode: error.statusCode || null,
        responseBody: error.responseBody || null,
        failedAt: new Date().toISOString(),
      };

      await this.repository.save(record);

      this.logger.error(
        {
          err: error,
          twilioCallSid: payload.CallSid,
          localCallId: record.localCallId,
        },
        "Failed to create Ultravox call for inbound Twilio call",
      );

      return this.#buildFailureTwiml();
    }
  }

  #buildConnectTwiml(joinUrl) {
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: joinUrl });
    return response.toString();
  }

  #buildFailureTwiml() {
    const response = new twilio.twiml.VoiceResponse();
    response.say(
      { voice: "alice" },
      "Sorry, we are unable to connect your call right now. Please try again in a moment.",
    );
    response.hangup();
    return response.toString();
  }
}

module.exports = { CallService };
