import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { ulid } from 'ulid';

import { env } from './shared/config/env';
import { logger } from './shared/logger';

import { authRoutes } from '@/modules/auth/public';
import { memberRoutes } from '@/modules/members/public';
import { orgRoutes } from '@/modules/org/public';
import { roleRoutes } from '@/modules/roles/public';
import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';
import { notificationPlugin } from '@/shared/notifications/plugin';

export async function buildApp() {
  const fastify = Fastify({
    bodyLimit: env.MAX_BODY_LIMIT,
    loggerInstance: logger,
    genReqId: (req) => req.headers['x-request-id']?.toString() ?? ulid(),
    requestIdLogLabel: 'reqId',
    requestIdHeader: 'x-request-id',
  });

  await fastify.setValidatorCompiler(validatorCompiler);
  await fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(import('@fastify/helmet'), {
    hsts: { maxAge: env.HELMET_HSTS_MAX_AGE, includeSubDomains: true, preload: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    noSniff: true,
  });

  await fastify.register(fastifyCookie);

  fastify.setErrorHandler(createErrorHandler(fastify));

  await fastify.register(notificationPlugin);

  await fastify.register(
    async (instance) => {
      await instance.register(registerHealthPlugin);
      await instance.register(authRoutes, { prefix: '/auth' });
      await instance.register(orgRoutes, { prefix: '/orgs' });
      await instance.register(memberRoutes, { prefix: '/members' });
      await instance.register(roleRoutes, { prefix: '/roles' });
    },
    { prefix: '/api/v1' },
  );

  return fastify;
}
