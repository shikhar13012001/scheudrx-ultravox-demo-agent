const twilio = require("twilio");
const { config } = require("../config");

function buildCandidateUrls(request) {
  const candidates = new Set();
  const forwardedProto = (request.get("X-Forwarded-Proto") || request.protocol || "https").split(",")[0].trim();
  const forwardedHost = (request.get("X-Forwarded-Host") || request.get("Host") || "").split(",")[0].trim();

  if (forwardedHost) {
    candidates.add(new URL(`${forwardedProto}://${forwardedHost}${request.originalUrl}`).toString());
  }

  candidates.add(new URL(request.originalUrl, config.PUBLIC_BASE_URL).toString());
  return [...candidates];
}

function verifyTwilioSignature(request) {
  if (!config.TWILIO_VALIDATE_SIGNATURES) {
    return true;
  }

  const signature = request.get("X-Twilio-Signature");
  if (!signature) {
    return false;
  }

  const candidateUrls = buildCandidateUrls(request);
  return candidateUrls.some((url) =>
    twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, url, request.body),
  );
}

module.exports = {
  verifyTwilioSignature,
};
