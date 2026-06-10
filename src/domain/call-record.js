const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function createIncomingTwilioCallRecord(payload, { localCallId = crypto.randomUUID(), timestamp = nowIso() } = {}) {
  return {
    localCallId,
    createdAt: timestamp,
    updatedAt: timestamp,
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
}

function touchCallRecord(record, timestamp = nowIso()) {
  record.updatedAt = timestamp;
  return record;
}

function attachUltravoxBridge(record, ultravoxCall) {
  record.state = "bridging";
  record.ultravox.callId = ultravoxCall.callId;
  record.ultravox.joinUrl = ultravoxCall.joinUrl;
  record.ultravox.status = "created";
  record.lastError = null;
  return record;
}

function markBridgeFailure(record, error, timestamp = nowIso()) {
  record.state = "failed";
  record.lastError = {
    message: error.message,
    statusCode: error.statusCode || null,
    responseBody: error.responseBody || null,
    failedAt: timestamp,
  };
  return record;
}

function appendTwilioStatusEvent(record, payload, timestamp = nowIso()) {
  record.twilio.status = payload.CallStatus || record.twilio.status;
  record.twilio.statusEvents.push({
    receivedAt: timestamp,
    payload,
  });

  if (payload.CallStatus === "completed") {
    record.state = "completed";
  }

  return record;
}

function appendUltravoxEvent(record, eventPayload, timestamp = nowIso()) {
  record.ultravox.status = eventPayload.event;
  record.ultravox.events.push({
    receivedAt: timestamp,
    payload: eventPayload,
  });

  if (eventPayload.event === "call.joined") {
    record.state = "live";
  } else if (eventPayload.event === "call.ended" || eventPayload.event === "call.billed") {
    record.state = "completed";
  }

  return record;
}

module.exports = {
  appendTwilioStatusEvent,
  appendUltravoxEvent,
  attachUltravoxBridge,
  createIncomingTwilioCallRecord,
  markBridgeFailure,
  nowIso,
  touchCallRecord,
};
