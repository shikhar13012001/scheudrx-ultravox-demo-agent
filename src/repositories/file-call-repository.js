const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

class FileCallRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { calls: [] };
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const file = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(file);
      this.state = {
        calls: Array.isArray(parsed.calls) ? parsed.calls : [],
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      await this.#persist();
    }
  }

  async getByTwilioCallSid(callSid) {
    return this.state.calls.find((call) => call.twilio?.callSid === callSid) || null;
  }

  async getByUltravoxCallId(callId) {
    return this.state.calls.find((call) => call.ultravox?.callId === callId) || null;
  }

  async createIncomingTwilioCall(payload) {
    const record = {
      localCallId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: "received",
      twilio: {
        callSid: payload.CallSid,
        accountSid: payload.AccountSid || null,
        from: payload.From || null,
        to: payload.To || null,
        direction: payload.Direction || "inbound",
        status: payload.CallStatus || "ringing",
        initialPayload: payload,
        statusEvents: [],
      },
      ultravox: {
        callId: null,
        joinUrl: null,
        status: "pending",
        events: [],
      },
      lastError: null,
    };

    this.state.calls.push(record);
    await this.#persist();
    return record;
  }

  async save(call) {
    const index = this.state.calls.findIndex((entry) => entry.localCallId === call.localCallId);
    if (index === -1) {
      this.state.calls.push(call);
    } else {
      this.state.calls[index] = call;
    }

    call.updatedAt = new Date().toISOString();
    await this.#persist();
    return call;
  }

  async appendTwilioStatusEvent(callSid, payload) {
    let record = await this.getByTwilioCallSid(callSid);

    if (!record) {
      record = await this.createIncomingTwilioCall(payload);
    }

    record.twilio.status = payload.CallStatus || record.twilio.status;
    record.twilio.statusEvents.push({
      receivedAt: new Date().toISOString(),
      payload,
    });

    if (payload.CallStatus === "completed") {
      record.state = "completed";
    }

    return this.save(record);
  }

  async appendUltravoxEvent(callId, eventPayload) {
    const record = await this.getByUltravoxCallId(callId);
    if (!record) {
      return null;
    }

    record.ultravox.status = eventPayload.event;
    record.ultravox.events.push({
      receivedAt: new Date().toISOString(),
      payload: eventPayload,
    });

    if (eventPayload.event === "call.joined") {
      record.state = "live";
    } else if (eventPayload.event === "call.ended" || eventPayload.event === "call.billed") {
      record.state = "completed";
    }

    return this.save(record);
  }

  async #persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const tmpFilePath = `${this.filePath}.${process.pid}.tmp`;
      const body = JSON.stringify(this.state, null, 2);
      await fs.writeFile(tmpFilePath, body, "utf8");
      await fs.rename(tmpFilePath, this.filePath);
    });

    return this.writeQueue;
  }
}

module.exports = { FileCallRepository };
