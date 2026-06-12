const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.NODE_ENV = "test";
process.env.PUBLIC_BASE_URL = "https://api.example.test";
process.env.TWILIO_AUTH_TOKEN = "twilio-auth-token";
process.env.TWILIO_VALIDATE_SIGNATURES = "true";
process.env.ULTRAVOX_API_KEY = "ultravox-api-key";
process.env.ULTRAVOX_AGENT_ID = "agent-1";
process.env.ULTRAVOX_WEBHOOK_SECRET = "ultravox-webhook-secret";
process.env.TOOLS_API_KEY = "test-tools-api-key-with-32-characters";
process.env.CALL_STORE_DRIVER = "file";

const { createApp } = require("../../src/app");

function createCallService(overrides = {}) {
  return {
    handleInboundTwilioWebhook: async () => "<Response></Response>",
    recordTwilioStatus: async () => undefined,
    recordUltravoxCallback: async () => undefined,
    ...overrides,
  };
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await run({
      request: (path, options = {}) => fetch(`${baseUrl}${path}`, options),
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function readJson(response) {
  return response.json();
}

test("GET /health returns the public health contract", async () => {
  const app = createApp({ callService: createCallService(), supabaseClient: null, nettuClient: null });

  await withServer(app, async ({ request }) => {
    const response = await request("/health");
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "schedurx-ultravox-demo-api");
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("POST /webhooks/twilio/incoming rejects missing Twilio signatures", async () => {
  const app = createApp({ callService: createCallService(), supabaseClient: null, nettuClient: null });

  await withServer(app, async ({ request }) => {
    const response = await request("/webhooks/twilio/incoming", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CA123" }),
    });
    const body = await readJson(response);

    assert.equal(response.status, 403);
    assert.deepEqual(body, { error: "Invalid Twilio signature" });
  });
});

test("POST /webhooks/twilio/status rejects missing Twilio signatures", async () => {
  const app = createApp({ callService: createCallService(), supabaseClient: null, nettuClient: null });

  await withServer(app, async ({ request }) => {
    const response = await request("/webhooks/twilio/status", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CA123", CallStatus: "completed" }),
    });
    const body = await readJson(response);

    assert.equal(response.status, 403);
    assert.deepEqual(body, { error: "Invalid Twilio signature" });
  });
});

test("POST /webhooks/ultravox rejects missing Ultravox signatures", async () => {
  const app = createApp({ callService: createCallService(), supabaseClient: null, nettuClient: null });

  await withServer(app, async ({ request }) => {
    const response = await request("/webhooks/ultravox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "call.ended", call: { callId: "call-1" } }),
    });
    const body = await readJson(response);

    assert.equal(response.status, 403);
    assert.deepEqual(body, { error: "Invalid Ultravox signature" });
  });
});

test("POST /tools/debug/echo stays available without bearer auth", async () => {
  const app = createApp({ callService: createCallService(), supabaseClient: null, nettuClient: null });

  await withServer(app, async ({ request }) => {
    const response = await request("/tools/debug/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testMessage: "hello" }),
    });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.message, "Echo received. Check server logs for full request details.");
    assert.deepEqual(body.received.body, { testMessage: "hello" });
  });
});

test("POST /tools/* requires bearer auth", async () => {
  const app = createApp({
    callService: createCallService(),
    supabaseClient: null,
    nettuClient: null,
  });

  await withServer(app, async ({ request }) => {
    const response = await request("/tools/patients/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ultravoxCallId: "call-1" }),
    });
    const body = await readJson(response);

    assert.equal(response.status, 401);
    assert.deepEqual(body, { error: "Unauthorized" });
  });
});

test("POST /tools/patients/identify preserves missing context response shape", async () => {
  const app = createApp({
    callService: createCallService(),
    supabaseClient: null,
    nettuClient: null,
  });

  await withServer(app, async ({ request }) => {
    const response = await request("/tools/patients/identify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.TOOLS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ultravoxCallId: "call-1" }),
    });
    const body = await readJson(response);

    assert.equal(response.status, 422);
    assert.deepEqual(body, { error: "Unable to resolve clinic or caller from call context" });
  });
});

test("POST /tools/calendar/slots preserves structured calendar error shape", async () => {
  const app = createApp({
    callService: createCallService(),
    supabaseClient: null,
    nettuClient: { getBookingSlots: async () => [] },
  });

  await withServer(app, async ({ request }) => {
    const response = await request("/tools/calendar/slots", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.TOOLS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ultravoxCallId: "missing-call" }),
    });
    const body = await readJson(response);

    assert.equal(response.status, 422);
    assert.deepEqual(body, {
      success: false,
      error: {
        code: "CLINIC_NOT_FOUND",
        message: `clinicId could not be resolved ${String.fromCharCode(0x2014)} call identify_patient first`,
        details: null,
      },
    });
  });
});
