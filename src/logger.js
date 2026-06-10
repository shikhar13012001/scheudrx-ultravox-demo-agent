const pino = require("pino");
const { config } = require("./config");

const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-api-key",
      "req.headers.x-twilio-signature",
      "req.headers.x-ultravox-webhook-signature",
      "response.body",
      "*.apiKey",
      "*.authToken",
    ],
    remove: true,
  },
});

module.exports = { logger };
