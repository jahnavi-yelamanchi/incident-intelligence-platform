import { z } from "zod";

const workerConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  INGESTION_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  CORRELATION_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  CORRELATION_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1_440).default(60),
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("remediation-v1"),
  KUBERNETES_ENABLED: z.enum(["true", "false"]).default("false"),
  KUBERNETES_ALLOWED_CLUSTER: z.string().min(1).optional(),
  AWS_RDS_FAILOVER_ENABLED: z.enum(["true", "false"]).default("false"),
  AWS_RDS_ALLOWED_REGIONS: z.string().default(""),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return workerConfigSchema.parse(environment);
}
