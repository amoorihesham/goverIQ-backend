import type { FastifyInstance } from 'fastify';

import { createAuthController } from './auth.controller';
import {
  loginRequestJsonSchema,
  registerRequestJsonSchema,
  resendOtpRequestJsonSchema,
  verifyRequestJsonSchema,
} from './schemas/json-schema';

import { getDatabaseClient } from '@/shared/database/client';
import { env } from '@/shared/config/env';

export async function authRoutes(fastify: FastifyInstance) {
  const db = getDatabaseClient();
  const controller = createAuthController(db);

  fastify.post('/register', { schema: registerRequestJsonSchema }, controller.register);
  fastify.post('/verify-email', { schema: verifyRequestJsonSchema }, controller.verifyEmail);
  fastify.post('/resend-otp', { schema: resendOtpRequestJsonSchema }, controller.resendOtp);
  fastify.post('/login', { schema: loginRequestJsonSchema }, controller.login);
  fastify.post('/refresh', controller.refresh);
  fastify.post('/logout', controller.logout);
}
