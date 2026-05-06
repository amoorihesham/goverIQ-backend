import type { FastifyInstance } from 'fastify';

import { createAuthController } from './auth.controller';
import {
  loginRequestJsonSchema,
  registerRequestJsonSchema,
  resendOtpRequestJsonSchema,
  verifyRequestJsonSchema,
} from './schemas/json-schema';

import { getDatabaseClient } from '@/shared/database/client';

export async function authRoutes(fastify: FastifyInstance) {
  const db = getDatabaseClient();
  const controller = createAuthController(db, {
    ENV: fastify.config.NODE_ENV,
    JWT_SECRET: fastify.config.JWT_SECRET,
    OTP_TTL_MS: fastify.config.OTP_TTL,
    OTP_RESEND_COOLDOWN_SEC: fastify.config.OTP_RESEND_COOLDOWN_SEC,
    ACCESS_TTL_SECONDS: fastify.config.ACCESS_TTL_SECONDS,
    REFRESH_TTL_SECONDS: fastify.config.REFRESH_TTL_SECONDS,
    REFRESH_COOKIE_NAME: fastify.config.REFRESH_COOKIE_NAME,
  });

  fastify.post('/register', { schema: registerRequestJsonSchema }, controller.register);
  fastify.post('/verify-email', { schema: verifyRequestJsonSchema }, controller.verifyEmail);
  fastify.post('/resend-otp', { schema: resendOtpRequestJsonSchema }, controller.resendOtp);
  fastify.post('/login', { schema: loginRequestJsonSchema }, controller.login);
  fastify.post('/refresh', controller.refresh);
  fastify.post('/logout', controller.logout);
}
