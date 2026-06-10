const assert = require("node:assert/strict");
const test = require("node:test");
const {
  appendTwilioStatusEvent,
  appendUltravoxEvent,
  attachUltravoxBridge,
  createIncomingTwilioCallRecord,
  markBridgeFailure,
} = require("../../src/domain/call-record");

const timestamp = "2026-06-11T00:00:00.000Z";

function createPayload(overrides = {}) {
  return {
    AccountSid: "AC123",
    CallSid: "CA123",
    CallStatus: "ringing",
    Direction: "inbound",
    From: "+15550000001",
    To: "+15550000002",
    ...overrides,
  };
}

test("creates a normalized incoming Twilio call record", () => {
  const payload = createPayload();
  const record = createIncomingTwilioCallRecord(payload, {
    localCallId: "local-1",
    timestamp,
  });

  assert.equal(record.localCallId, "local-1");
  assert.equal(record.createdAt, timestamp);
  assert.equal(record.updatedAt, timestamp);
  assert.equal(record.state, "received");
  assert.equal(record.twilio.callSid, "CA123");
  assert.deepEqual(record.twilio.statusEvents, []);
  assert.deepEqual(record.ultravox, {
    callId: null,
    joinUrl: null,
    status: "pending",
    events: [],
  });
});

test("updates Twilio and Ultravox lifecycle state consistently", () => {
  const record = createIncomingTwilioCallRecord(createPayload(), {
    localCallId: "local-1",
    timestamp,
  });

  attachUltravoxBridge(record, {
    callId: "uv-1",
    joinUrl: "wss://example.test/join",
  });
  assert.equal(record.state, "bridging");
  assert.equal(record.ultravox.status, "created");

  appendUltravoxEvent(record, { event: "call.joined" }, "2026-06-11T00:01:00.000Z");
  assert.equal(record.state, "live");
  assert.equal(record.ultravox.events.length, 1);

  appendTwilioStatusEvent(record, createPayload({ CallStatus: "completed" }), "2026-06-11T00:02:00.000Z");
  assert.equal(record.state, "completed");
  assert.equal(record.twilio.status, "completed");
  assert.equal(record.twilio.statusEvents.length, 1);
});

test("captures bridge failures with storage-safe error details", () => {
  const record = createIncomingTwilioCallRecord(createPayload(), {
    localCallId: "local-1",
    timestamp,
  });
  const error = new Error("upstream failed");
  error.statusCode = 502;
  error.responseBody = { error: "bad gateway" };

  markBridgeFailure(record, error, "2026-06-11T00:03:00.000Z");

  assert.equal(record.state, "failed");
  assert.deepEqual(record.lastError, {
    message: "upstream failed",
    statusCode: 502,
    responseBody: { error: "bad gateway" },
    failedAt: "2026-06-11T00:03:00.000Z",
  });
});
