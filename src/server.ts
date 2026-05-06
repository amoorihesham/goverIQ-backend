import fastifyCookie from '@fastify/cookie';
import fastifyEnv from '@fastify/env';
import Fastify from 'fastify';

import { fastifySchema } from './shared/config/env';
import { logger } from './shared/logger';
import { runMigrations } from './shared/database/migrate';
import { createDatabaseClient } from './shared/database/client';
import { authPlugin } from './modules/auth';

import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    },
  });

  await fastify.register(fastifyEnv, { dotenv: true, schema: fastifySchema });

  await fastify.register(fastifyCookie, {
    secret: fastify.config.COOKIE_SECRET,
    hook: 'onRequest',
  });

  logger.info('Initializing Database Connection...');
  const db = createDatabaseClient(fastify.config.DATABASE_URL);

  logger.info('Running database migrations...');
  await runMigrations(db);

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
