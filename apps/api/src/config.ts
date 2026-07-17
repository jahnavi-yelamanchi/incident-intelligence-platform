import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  DATABASE_URL: z.string().url().default("postgresql://incident_app:incident_app@localhost:5432/incident"),
  AUTH0_ISSUER_BASE_URL: z.string().url().optional(),
  AUTH0_AUDIENCE: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_INVESTIGATION_MODEL: z.string().min(1).default("gpt-5.6"),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  INTEGRATION_OAUTH_STATE_SECRET: z.string().min(32).optional(),
  SLACK_CLIENT_ID: z.string().min(1).optional(),
  SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  SLACK_REDIRECT_URI: z.string().url().optional(),
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("remediation-v1"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  DEMO_ORGANIZATION_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return configSchema.parse(environment);
}
