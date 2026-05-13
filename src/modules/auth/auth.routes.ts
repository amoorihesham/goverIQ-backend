import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { createAuthController } from './auth.controller';
import {
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  verifyRequestSchema,
} from './schemas/zod';

import { db } from '@/shared/database/client';

export async function authRoutes(fastify: FastifyInstance) {
  const controller = createAuthController(db, fastify.dispatcher);

  fastify.withTypeProvider<ZodTypeProvider>().post('/register', { schema: registerRequestSchema }, controller.register);
  fastify
    .withTypeProvider<ZodTypeProvider>()
    .post('/verify-email', { schema: verifyRequestSchema }, controller.verifyEmail);
  fastify
    .withTypeProvider<ZodTypeProvider>()
    .post('/resend-otp', { schema: resendOtpRequestSchema }, controller.resendOtp);
  fastify.withTypeProvider<ZodTypeProvider>().post('/login', { schema: loginRequestSchema }, controller.login);
  fastify.withTypeProvider<ZodTypeProvider>().post('/refresh', controller.refresh);
  fastify.withTypeProvider<ZodTypeProvider>().post('/logout', controller.logout);
}
