import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { authPlugin } from '@/modules/auth';
import { createDatabaseClient } from '@/shared/database/client';
import { createErrorHandler } from '@/shared/errors/envelope';

export async function buildAuthTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  createDatabaseClient(app.config.DATABASE_URL);

  await app.register(fastifyCookie, {
    secret: app.config.COOKIE_SECRET,
    hook: 'onRequest',
  });

  app.setErrorHandler(createErrorHandler(app));
  await app.register(authPlugin, { prefix: '/auth' });
  await app.ready();

  return app;
}
