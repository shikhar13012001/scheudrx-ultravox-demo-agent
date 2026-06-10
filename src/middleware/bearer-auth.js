const crypto = require("node:crypto");
const { config } = require("../config");

function bearerAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = auth.slice(7);
  const expected = config.TOOLS_API_KEY;

  if (
    token.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

module.exports = { bearerAuth };
