import { config } from 'dotenv';
import { z } from 'zod';

config({ path: `.env.${process.env.NODE_ENV}` });

const envSchema = z.object({
  // ENVIRONMENT
  NODE_ENV: z.enum(['development', 'production', 'test'], 'NODE_ENV must be one of development, production, or test'),
  PORT: z.coerce.number('PORT must be a number').int().positive(),
  HOST: z.string('HOST must be a valid string'),
  LOG_LEVEL: z.enum(
    ['debug', 'info', 'warn', 'error', 'fatal'],
    'LOG_LEVEL must be one of debug, info, warn, error, or fatal',
  ),

  // SERVER CONFIG
  APP_BASE_URL: z.url(),
  HELMET_HSTS_MAX_AGE: z.coerce.number().int().positive(),
  MAX_BODY_LIMIT: z.coerce.number(),

  // DATABASE CONFIG
  DATABASE_URL: z.string('DATABASE_URL must be a valid URL'),
  DATABASE_POOL_MAX_SIZE: z.coerce.number(),
  DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().positive().default(200),

  // REDIS & QUEUE CONFIG
  REDIS_URL: z.url(),
  QUEUE_BACKEND: z.string().default('redis'),

  // JWT CONFIG
  JWT_ACCESS_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),

  // SMTP CONFIG
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string('SMTP_FROM must be a valid email'),

  // OTEL CONFIG
  OTEL_SERVICE_NAME: z.string().default('grove-iq'),
  OTEL_SERVICE_VERSION: z.string().default('1.0.0'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),

  // SENTRY CONFIG
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables.');
  console.error(parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
