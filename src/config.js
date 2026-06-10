const path = require("node:path");
const { z } = require("zod");

require("dotenv").config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_VALIDATE_SIGNATURES: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  ULTRAVOX_API_KEY: z.string().min(1),
  ULTRAVOX_API_BASE_URL: z.string().url().default("https://api.ultravox.ai/api"),
  ULTRAVOX_AGENT_ID: z.string().min(1),
  ULTRAVOX_RECORDING_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  ULTRAVOX_JOIN_TIMEOUT: z.string().default("30s"),
  ULTRAVOX_MAX_DURATION: z.string().default("1800s"),
  ULTRAVOX_WEBHOOK_SECRET: z.string().min(16),
  CALL_STORE_DRIVER: z.enum(["file", "supabase"]).default("supabase"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_CALLS_TABLE: z.string().default("phone_calls"),
  CALL_STORE_PATH: z.string().default("./data/calls.json"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration\n${issues}`);
}

const config = {
  ...parsed.data,
  trustProxy: parsed.data.TRUST_PROXY,
  callStorePath: path.resolve(process.cwd(), parsed.data.CALL_STORE_PATH),
};

if (config.CALL_STORE_DRIVER === "supabase") {
  if (!config.SUPABASE_URL) {
    throw new Error("Invalid environment configuration\nSUPABASE_URL: Required when CALL_STORE_DRIVER=supabase");
  }

  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Invalid environment configuration\nSUPABASE_SERVICE_ROLE_KEY: Required when CALL_STORE_DRIVER=supabase",
    );
  }
}

module.exports = { config };
