import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { ulid } from 'ulid';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { authPlugin } from './modules/auth';
import { orgPlugin, invitationsPublicPlugin } from './modules/org';
import { env } from './shared/config/env';

import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';
import { logger } from './shared/logger';

export async function buildApp() {
  const fastify = Fastify({
    loggerInstance: logger,
    genReqId: (req) => req.headers['x-request-id']?.toString() ?? ulid(),
    requestIdLogLabel: 'reqId',
    requestIdHeader: 'x-request-id',
  });

  await fastify.setValidatorCompiler(validatorCompiler);
  await fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
  });

  fastify.setErrorHandler(createErrorHandler(fastify));

  await fastify.register(
    async (instance) => {
      await instance.register(registerHealthPlugin);
      await instance.register(authPlugin, { prefix: '/auth' });
      await instance.register(orgPlugin);
    },
    { prefix: '/api/v1' },
  );

  await fastify.register(invitationsPublicPlugin);

  return fastify;
}
