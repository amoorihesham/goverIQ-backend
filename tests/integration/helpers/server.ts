import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';

import { authRoutes } from '@/modules/auth/public';
import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { runMigrations } from '@/shared/database/migrate';
import { createErrorHandler } from '@/shared/errors/envelope';
import { logger } from '@/shared/logger';
import { buildApp } from '@/app';

export async function buildAuthTestServer() {
  logger.info('Running database migrations...');
  await runMigrations(db);

  const app = Fastify({ logger: false });

  await app.register(fastifyCookie);

  app.setErrorHandler(createErrorHandler(app as any));
  await app.register(authRoutes, { prefix: '/auth' });

  app.get('/protected', { preHandler: identityRequired }, (request, reply) => {
    reply.send({ user: request.user });
  });

  await app.ready();

  return app;
}

export async function buildAppTestServer() {
  await runMigrations(db);
  const app = await buildApp();
  await app.ready();
  return app;
}
