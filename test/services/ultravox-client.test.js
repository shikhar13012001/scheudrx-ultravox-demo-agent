const assert = require("node:assert/strict");
const test = require("node:test");
const { UltravoxClient } = require("../../src/services/ultravox-client");

const config = {
  PUBLIC_BASE_URL: "https://api.example.test",
  ULTRAVOX_API_BASE_URL: "https://ultravox.example.test/api",
  ULTRAVOX_API_KEY: "api-key",
  ULTRAVOX_AGENT_ID: "agent-1",
  ULTRAVOX_JOIN_TIMEOUT: "30s",
  ULTRAVOX_MAX_DURATION: "1800s",
  ULTRAVOX_RECORDING_ENABLED: false,
  ULTRAVOX_WEBHOOK_SECRET: "webhook-secret",
};

test("creates an inbound Ultravox call with Twilio medium and callbacks", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ callId: "call-1", joinUrl: "wss://join.example.test" }),
    };
  };

  const client = new UltravoxClient({ config, fetchImpl, requestTimeoutMs: 1000 });
  const response = await client.createInboundCall({ localCallId: "local-1" });

  assert.deepEqual(response, { callId: "call-1", joinUrl: "wss://join.example.test" });
  assert.equal(request.url, "https://ultravox.example.test/api/agents/agent-1/calls");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["X-API-Key"], "api-key");

  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.medium, { twilio: {} });
  assert.deepEqual(body.metadata, { localCallId: "local-1", toolsBaseUrl: "https://api.example.test/tools" });
  assert.equal(body.callbacks.joined.url, "https://api.example.test/webhooks/ultravox");
  assert.equal(body.callbacks.ended.secrets[0], "webhook-secret");
  assert.equal(body.callbacks.billed.url, "https://api.example.test/webhooks/ultravox");
});

test("rejects successful Ultravox responses missing bridge fields", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ callId: "call-1" }),
  });

  const client = new UltravoxClient({ config, fetchImpl, requestTimeoutMs: 1000 });

  await assert.rejects(
    () => client.createInboundCall(),
    /missing callId or joinUrl/,
  );
});
