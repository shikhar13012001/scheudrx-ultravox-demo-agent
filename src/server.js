const { createClient } = require("@supabase/supabase-js");
const { config } = require("./config");
const { logger } = require("./logger");
const { createCallRepository } = require("./repositories/call-repository-factory");
const { UltravoxClient } = require("./services/ultravox-client");
const { NettuClient }    = require("./services/nettu-client");
const { CallService } = require("./services/call-service");
const { createApp } = require("./app");

function registerShutdownHandlers(server) {
  const shutdown = (signal) => {
    logger.info({ signal }, "Shutdown requested");

    server.close((error) => {
      if (error) {
        logger.error({ err: error }, "Failed to close server cleanly");
        process.exit(1);
      }

      logger.info("Server stopped");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error({ signal }, "Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function start() {
  const supabaseClient = config.SUPABASE_URL
    ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  const repository = createCallRepository({ config, logger });
  await repository.init();

  const ultravoxClient = new UltravoxClient({ config, logger });

  const nettuClient = config.NETTU_BASE_URL && config.NETTU_API_KEY
    ? new NettuClient({ baseUrl: config.NETTU_BASE_URL, apiKey: config.NETTU_API_KEY, logger })
    : null;

  if (!nettuClient) {
    logger.warn("NETTU_BASE_URL or NETTU_API_KEY not set — calendar tools will be unavailable");
  }

  const callService = new CallService({
    repository,
    ultravoxClient,
    logger,
    supabaseClient,
  });

  const app = createApp({ callService, supabaseClient, nettuClient });
  const server = app.listen(config.PORT, () => {
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

  registerShutdownHandlers(server);
}

start().catch((error) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
