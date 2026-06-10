const { FileCallRepository } = require("./file-call-repository");
const { SupabaseCallRepository } = require("./supabase-call-repository");

function createCallRepository({ config, logger }) {
  if (config.CALL_STORE_DRIVER === "file") {
    return new FileCallRepository(config.callStorePath);
  }

  return new SupabaseCallRepository({ config, logger });
}

module.exports = { createCallRepository };
