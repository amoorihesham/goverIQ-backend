import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { createAuthController } from './auth.controller';
import {
  loginRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  verifyRequestSchema,
} from './schemas/zod';

import { db } from '@/shared/database/client';

export async function authRoutes(fastify: FastifyInstance) {
  const controller = createAuthController(db);

  fastify
    .withTypeProvider<ZodTypeProvider>()
    .post('/register', { schema: registerRequestSchema }, controller.register);
  fastify.post('/verify-email', { schema: verifyRequestSchema }, controller.verifyEmail);
  fastify.post('/resend-otp', { schema: resendOtpRequestSchema }, controller.resendOtp);
  fastify.post('/login', { schema: loginRequestSchema }, controller.login);
  fastify.post('/refresh', controller.refresh);
  fastify.post('/logout', controller.logout);
}
