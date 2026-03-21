import dotenv from 'dotenv';
import { z } from 'zod';
import { DEFAULT_APP_VERSION } from './appVersion.js';

dotenv.config();

const CSRF_DEFAULT_SECRET = 'dev-csrf-secret-please-change-2026';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(86_400_000)
    .default(6 * 60 * 60 * 1000),
  GOOGLE_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  TEMPLATE_MARKETPLACE_URL: z.string().url().optional(),
  TEMPLATE_MARKETPLACE_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600_000)
    .default(5 * 60 * 1000),
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173'
    )
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),
  TRUSTED_PROXY_IPS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  SLACK_SIGNING_SECRET: z.string().optional(),
  DISCORD_WEBHOOK_SECRET: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  REDIS_PASSWORD: z.string().min(8).optional(),
  DB_TRANSACTION_RETRY_MAX: z.coerce.number().int().min(0).max(5).default(2),
  DB_TRANSACTION_RETRY_BASE_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(5_000)
    .default(25),
  DB_TRANSACTION_RETRY_MAX_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(30_000)
    .default(250),
  APP_VERSION: z.string().default(DEFAULT_APP_VERSION),
  CSRF_PROTECTION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  CSRF_SECRET: z.string().min(32).default(CSRF_DEFAULT_SECRET),
  POLICY_CACHE_TTL_MS: z.coerce.number().int().min(0).max(3_600_000).default(30_000),
  WORKSPACE_ROOT: z.string().default(process.cwd()),
  EVENT_BUS_CHANNEL: z.string().default('biuro:events'),
  SCHEDULER_STREAM_KEY: z.string().default('biuro:scheduler:wakeups'),
  SCHEDULER_STREAM_BLOCK_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .default(1000),
  SCHEDULER_ERROR_BACKOFF_MIN_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(60_000)
    .default(500),
  SCHEDULER_ERROR_BACKOFF_MAX_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(300_000)
    .default(10_000),
  BASH_SANDBOX_MODE: z.enum(['docker', 'host']).default('docker'),
  BASH_SANDBOX_DOCKER_BINARY: z.string().default('docker'),
  BASH_SANDBOX_IMAGE: z.string().default('alpine/git:2.47.2'),
  BASH_SANDBOX_WORKDIR: z.string().default('/workspace'),
  BASH_SANDBOX_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(10000),
  BASH_SANDBOX_MEMORY_MB: z.coerce
    .number()
    .int()
    .min(64)
    .max(4096)
    .default(256),
  BASH_SANDBOX_CPU_LIMIT: z.coerce.number().min(0.1).max(8).default(1),
  BASH_SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(512).default(64),
  BASH_SANDBOX_USER: z.string().default('65534:65534'),
  BASH_SANDBOX_ALLOWED_BINARIES: z
    .string()
    .default(
      'git,ls,pwd,cat,grep,rg,find,sed,awk,head,tail,wc,sort,uniq,cut,printf,stat,test,mkdir,cp,mv,touch,node,npm,pnpm,npx,tsx,tsc,vite,python,python3,pytest'
    )
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  LLM_ROUTER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  LLM_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3),
  LLM_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3_600_000)
    .default(60_000),
  LLM_ROUTER_FALLBACK_ORDER: z
    .string()
    .default('gemini,claude,openai')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  LLM_MOCK_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LLM_PRICING_OVERRIDES: z.string().optional(),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  REST_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60 * 1000),
  REST_RATE_LIMIT_MAX: z.coerce.number().default(1000),
  LLM_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60 * 1000),
  LLM_RATE_LIMIT_MAX: z.coerce.number().default(20),
  WS_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60 * 1000),
  WS_RATE_LIMIT_MAX: z.coerce.number().default(30),
  WS_MESSAGE_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(10 * 1000),
  WS_MESSAGE_RATE_LIMIT_MAX: z.coerce.number().default(25),
  WS_BROADCAST_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(10 * 1000),
  WS_BROADCAST_RATE_LIMIT_MAX: z.coerce.number().default(200),
  OTEL_SERVICE_NAME: z.string().default('autonomiczne-biuro'),
  OTEL_TRACE_CONSOLE_EXPORTER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  OTEL_TRACE_HISTORY_LIMIT: z.coerce
    .number()
    .int()
    .min(10)
    .max(1000)
    .default(200),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  WORKER_METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  DAILY_DIGEST_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  DAILY_DIGEST_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(18),
  DAILY_DIGEST_MINUTE_UTC: z.coerce.number().int().min(0).max(59).default(0),
  DAILY_DIGEST_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(3_600_000)
    .default(60_000),
  AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  PORT: z.coerce.number().default(3100),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().default(30000),
  MAX_HEARTBEATS_PER_HOUR: z.coerce.number().int().min(1).default(60),
  MAX_CONCURRENT_HEARTBEATS: z.coerce.number().int().min(1).default(20),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);
if (
  env.NODE_ENV === 'production' &&
  env.CSRF_SECRET === CSRF_DEFAULT_SECRET
) {
  throw new Error(
    'CSRF_SECRET must be changed in production! Set a strong value with: openssl rand -hex 32'
  );
}
