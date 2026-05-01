import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string('DATABASE_URL must be a valid URL'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  PORT: z.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string('SMTP_FROM must be a valid email'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof envSchema>;
export const fastifySchema = z.toJSONSchema(envSchema, { target: 'draft-07' });
