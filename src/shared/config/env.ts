import dotenv from 'dotenv';
import { z } from 'zod';

const envFilePath = `.env.${process.env.NODE_ENV}`;
dotenv.config({ path: envFilePath });

const envSchema = z.object({
  NODE_ENV: z.enum(
    ['development', 'production', 'test'],
    'NODE_ENV must be one of development, production, or test',
  ),
  PORT: z.coerce.number('PORT must be a number').int().positive(),
  HOST: z.string('HOST must be a valid string'),
  LOG_LEVEL: z.enum(
    ['debug', 'info', 'warn', 'error', 'fatal'],
    'LOG_LEVEL must be one of debug, info, warn, error, or fatal',
  ),

  MAX_BODY_LIMIT: z.coerce.number(),

  DATABASE_URL: z.string('DATABASE_URL must be a valid URL'),
  DATABASE_POOL_MAX_SIZE: z.coerce.number(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
  REFRESH_COOKIE_NAME: z.string('REFRESH_COOKIE_NAME must be a valid string'),
  ACCESS_TTL_SECONDS: z.coerce.number('ACCESS_TTL_SECONDS must be a number'),
  REFRESH_TTL_SECONDS: z.coerce.number('REFRESH_TTL_SECONDS must be a number'),
  OTP_TTL_MS: z.coerce.number('OTP_TTL_MS must be a number'),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number('OTP_RESEND_COOLDOWN_SEC must be a number'),

  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string('SMTP_FROM must be a valid email'),
  REDIS_URL: z.url(),
  QUEUE_BACKEND: z
    .enum(['memory', 'redis'])
    .default(process.env.NODE_ENV === 'production' ? 'redis' : 'memory'),
  APP_BASE_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables.');
  console.error(parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
