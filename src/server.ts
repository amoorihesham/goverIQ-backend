import fastifyEnv from '@fastify/env';
import Fastify from 'fastify';

import { fastifySchema } from './shared/config/env';

import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      transport: { target: 'pino-pretty', options: { colorize: true } },
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  await fastify.register(fastifyEnv, { dotenv: true, schema: fastifySchema });

  fastify.setErrorHandler(createErrorHandler(fastify));

  await fastify.register(registerHealthPlugin);

  return fastify;
}
