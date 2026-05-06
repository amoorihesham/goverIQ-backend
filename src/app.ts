import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';

import { authPlugin } from './modules/auth';
import { env } from './shared/config/env';

import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    },
  });

  await fastify.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
  });

  fastify.setErrorHandler(createErrorHandler(fastify));

  await fastify.register(
    async (instance) => {
      await instance.register(registerHealthPlugin);
      await instance.register(authPlugin, { prefix: '/auth' });
    },
    { prefix: '/api/v1' },
  );

  return fastify;
}
