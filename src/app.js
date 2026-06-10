const express = require("express");
const pinoHttp = require("pino-http");
const { config } = require("./config");
const { logger } = require("./logger");
const { verifyTwilioSignature } = require("./security/twilio-signature");
const { verifyUltravoxSignature } = require("./security/ultravox-signature");
const { bearerAuth } = require("./middleware/bearer-auth");
const { createToolsRouter } = require("./routes/tools");

function captureRawBody(request, response, buffer) {
  if (buffer?.length) {
    request.rawBody = Buffer.from(buffer);
  }
}

function createApp({ callService, supabaseClient }) {
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

  app.post("/webhooks/twilio/incoming", async (request, response, next) => {
    try {
      if (!verifyTwilioSignature(request)) {
        request.log.warn("Rejected Twilio inbound webhook with invalid signature");
        return response.status(403).json({ error: "Invalid Twilio signature" });
      }

      const twiml = await callService.handleInboundTwilioWebhook(request.body);
      response.type("text/xml").send(twiml);
    } catch (error) {
      next(error);
    }
  });

  app.post("/webhooks/twilio/status", async (request, response, next) => {
    try {
      if (!verifyTwilioSignature(request)) {
        request.log.warn("Rejected Twilio status webhook with invalid signature");
        return response.status(403).json({ error: "Invalid Twilio signature" });
      }

      await callService.recordTwilioStatus(request.body);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post("/webhooks/ultravox", async (request, response, next) => {
    try {
      if (!verifyUltravoxSignature(request)) {
        request.log.warn("Rejected Ultravox webhook with invalid signature");
        return response.status(403).json({ error: "Invalid Ultravox signature" });
      }

      await callService.recordUltravoxCallback(request.body);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.use("/tools", bearerAuth, createToolsRouter(supabaseClient));

  app.use((error, request, response, next) => {
    const statusCode = error.statusCode || 500;
    const message = error.expose ? error.message : "Internal server error";
    const logLevel = statusCode >= 500 ? "error" : "warn";

    request.log[logLevel]({ err: error }, "Request failed");
    response.status(statusCode).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
