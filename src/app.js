const express = require("express");
const pinoHttp = require("pino-http");
const { config } = require("./config");
const { logger } = require("./logger");
const { bearerAuth } = require("./middleware/bearer-auth");
const { errorHandler } = require("./middleware/error-handler");
const { createWebhooksRouter } = require("./routes/webhooks");
const { createToolsRouter } = require("./routes/tools");
const callStore = require("./stores/call-store");

function captureRawBody(request, response, buffer) {
  if (buffer?.length) {
    request.rawBody = Buffer.from(buffer);
  }
}

function createApp({ callService, supabaseClient, nettuClient }) {
  const app = express();
  app.set("trust proxy", config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId(request) {
        return request.headers["x-request-id"] || request.headers["x-twilio-callsid"] || undefined;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, verify: captureRawBody }));
  app.use(express.json({ verify: captureRawBody }));

  app.get("/health", (request, response) => {
    response.json({
      ok: true,
      service: "schedurx-ultravox-demo-api",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/webhooks", createWebhooksRouter(callService));

  // No-auth echo tool — register BEFORE bearerAuth so Ultravox can call it without a key.
  // Use this to inspect exactly what Ultravox sends (headers + body) during a tool call.
  app.post("/tools/debug/echo", (request, response) => {
    const payload = { headers: request.headers, body: request.body };
    request.log.info(payload, "[tool:debug] echo invoked");
    response.json({
      message: "Echo received. Check server logs for full request details.",
      received: payload,
    });
  });

  app.use("/tools", bearerAuth, createToolsRouter(supabaseClient, callStore, nettuClient));

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
