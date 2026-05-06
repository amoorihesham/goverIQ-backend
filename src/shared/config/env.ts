import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string('DATABASE_URL must be a valid URL'),

  PASSWORD_SALT_ROUNDS: z.coerce.number().int().positive(),

  OTP_LENGTH: z.coerce.number().int().positive(),
  OTP_TTL: z.coerce.number().int().positive(),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().positive(),

  ACCESS_TTL_SECONDS: z.coerce.number().int().positive(),
  REFRESH_TTL_SECONDS: z.coerce.number().int().positive(),
  REFRESH_COOKIE_NAME: z.string().default('refresh_token'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),

  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string('SMTP_FROM must be a valid email'),
});

export type Env = z.infer<typeof envSchema>;
export const fastifySchema = z.toJSONSchema(envSchema, { target: 'draft-07' });

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  loadDotenv();
  cached = envSchema.parse(process.env);
  return cached;
}
