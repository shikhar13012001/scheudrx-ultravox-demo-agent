const { config } = require("./config");
const { logger } = require("./logger");
const { FileCallRepository } = require("./repositories/file-call-repository");
const { SupabaseCallRepository } = require("./repositories/supabase-call-repository");
const { UltravoxClient } = require("./services/ultravox-client");
const { CallService } = require("./services/call-service");
const { createApp } = require("./app");

async function start() {
  const repository =
    config.CALL_STORE_DRIVER === "supabase"
      ? new SupabaseCallRepository({ logger })
      : new FileCallRepository(config.callStorePath);
  await repository.init();

  const ultravoxClient = new UltravoxClient(logger);
  const callService = new CallService({
    repository,
    ultravoxClient,
    logger,
  });

  const app = createApp({ callService });
  app.listen(config.PORT, () => {
    logger.info(
        {
          port: config.PORT,
          publicBaseUrl: config.PUBLIC_BASE_URL,
          callStoreDriver: config.CALL_STORE_DRIVER,
          callStorePath: config.CALL_STORE_DRIVER === "file" ? config.callStorePath : undefined,
          supabaseTable: config.CALL_STORE_DRIVER === "supabase" ? config.SUPABASE_CALLS_TABLE : undefined,
        },
        "Server listening",
      );
  });
}

start().catch((error) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
