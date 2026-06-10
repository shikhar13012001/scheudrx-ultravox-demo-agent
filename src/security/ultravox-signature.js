const crypto = require("node:crypto");
const { config } = require("../config");

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function verifyUltravoxSignature(request) {
  const timestamp = request.get("X-Ultravox-Webhook-Timestamp");
  const signatures = request.get("X-Ultravox-Webhook-Signature");

  if (!timestamp || !signatures) {
    return false;
  }

  const requestTime = new Date(timestamp);
  if (Number.isNaN(requestTime.getTime())) {
    return false;
  }

  const ageMs = Math.abs(Date.now() - requestTime.getTime());
  if (ageMs > 60_000) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", config.ULTRAVOX_WEBHOOK_SECRET)
    .update(Buffer.concat([request.rawBody || Buffer.from(""), Buffer.from(timestamp)]))
    .digest("hex");

  return signatures
    .split(",")
    .map((value) => value.trim())
    .some((value) => value.length === expected.length && timingSafeEqualHex(value, expected));
}

module.exports = {
  verifyUltravoxSignature,
};
