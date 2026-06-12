const { Router } = require("express");
const { verifyTwilioSignature } = require("../security/twilio-signature");
const { verifyUltravoxSignature } = require("../security/ultravox-signature");
const callStore = require("../stores/call-store");

function createWebhooksRouter(callService) {
  const router = Router();

  router.post("/twilio/incoming", async (request, response, next) => {
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

  router.post("/twilio/status", async (request, response, next) => {
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

  router.post("/ultravox", async (request, response, next) => {
    try {
      if (!verifyUltravoxSignature(request)) {
        request.log.warn("Rejected Ultravox webhook with invalid signature");
        return response.status(403).json({ error: "Invalid Ultravox signature" });
      }

      await callService.recordUltravoxCallback(request.body);

      const endedCallId = request.body?.call?.callId;
      if (endedCallId && request.body?.event === "call.ended") {
        request.log.info({ ultravoxCallId: endedCallId, entry: callStore.get(endedCallId) }, "[callStore] removing ended call");
        callStore.remove(endedCallId);
      }

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createWebhooksRouter };
