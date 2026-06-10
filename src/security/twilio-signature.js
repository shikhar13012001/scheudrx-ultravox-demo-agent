const twilio = require("twilio");
const { config } = require("../config");

function buildPublicUrl(request) {
  return new URL(request.originalUrl, config.PUBLIC_BASE_URL).toString();
}

function verifyTwilioSignature(request) {
  if (!config.TWILIO_VALIDATE_SIGNATURES) {
    return true;
  }

  const signature = request.get("X-Twilio-Signature");
  if (!signature) {
    return false;
  }

  const url = buildPublicUrl(request);
  return twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, url, request.body);
}

module.exports = {
  verifyTwilioSignature,
};
