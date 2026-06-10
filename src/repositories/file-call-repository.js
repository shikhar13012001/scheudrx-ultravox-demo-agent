const fs = require("node:fs/promises");
const path = require("node:path");
const {
  appendTwilioStatusEvent,
  appendUltravoxEvent,
  createIncomingTwilioCallRecord,
  touchCallRecord,
} = require("../domain/call-record");

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
    const record = createIncomingTwilioCallRecord(payload);

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

    touchCallRecord(call);
    await this.#persist();
    return call;
  }

  async appendTwilioStatusEvent(callSid, payload) {
    let record = await this.getByTwilioCallSid(callSid);

    if (!record) {
      record = await this.createIncomingTwilioCall(payload);
    }

    appendTwilioStatusEvent(record, payload);
    return this.save(record);
  }

  async appendUltravoxEvent(callId, eventPayload) {
    const record = await this.getByUltravoxCallId(callId);
    if (!record) {
      return null;
    }

    appendUltravoxEvent(record, eventPayload);
    return this.save(record);
  }

  async #persist() {
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const tmpFilePath = `${this.filePath}.${process.pid}.tmp`;
        const body = JSON.stringify(this.state, null, 2);
        await fs.writeFile(tmpFilePath, body, "utf8");
        await fs.rename(tmpFilePath, this.filePath);
      });

    return this.writeQueue;
  }
}

module.exports = { FileCallRepository };
