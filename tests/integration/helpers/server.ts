import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { authPlugin } from '@/modules/auth';
import { identityRequired } from '@/shared/auth/identity';
import { env } from '@/shared/config/env';
import { createDatabaseClient } from '@/shared/database/client';
import { runMigrations } from '@/shared/database/migrate';
import { createErrorHandler } from '@/shared/errors/envelope';
import { logger } from '@/shared/logger';

export async function buildAuthTestServer(): Promise<FastifyInstance> {
  logger.info('Initializing Database Connection...');
  const db = createDatabaseClient(env.DATABASE_URL);

  logger.info('Running database migrations...');
  await runMigrations(db);

  logger.info('Building server...');
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
  });

  app.setErrorHandler(createErrorHandler(app));
  await app.register(authPlugin, { prefix: '/auth' });

  app.get('/protected', { preHandler: identityRequired }, (request, reply) => {
    reply.send({ user: request.user });
  });

  await app.ready();

  return app;
}
