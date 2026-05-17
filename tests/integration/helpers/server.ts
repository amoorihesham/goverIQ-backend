import { authRoutes } from '@/modules/auth/public';
import { orgRoutes } from '@/modules/org/public';
import { memberRoutes } from '@/modules/members/public';
import { roleRoutes } from '@/modules/roles/public';
import { invitionsRoutes } from '@/modules/invitions/public';
import { env } from '@/shared/config/env';
import { db } from '@/shared/database/client';
import { runMigrations } from '@/shared/database/migrate';
import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';
import { notificationPlugin } from '@/shared/notifications/plugin';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import fastifyCookie from '@fastify/cookie';

export async function buildTestServer() {
  const app = fastify({
    logger: false,
  });

  await app.setValidatorCompiler(validatorCompiler);
  await app.setSerializerCompiler(serializerCompiler);

  await app.register(import('@fastify/helmet'), {
    hsts: { maxAge: env.HELMET_HSTS_MAX_AGE, includeSubDomains: true, preload: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    noSniff: true,
  });
  await app.register(fastifyCookie);
  app.setErrorHandler(createErrorHandler(app));

  await app.register(notificationPlugin);

  await app.register(
    async (instance) => {
      await instance.register(registerHealthPlugin);
      await instance.register(authRoutes, { prefix: '/auth' });
      await instance.register(orgRoutes, { prefix: '/orgs' });
      await instance.register(memberRoutes, { prefix: '/members' });
      await instance.register(roleRoutes, { prefix: '/roles' });
      await instance.register(invitionsRoutes, { prefix: '/invitations' });
    },
    { prefix: '/api/v1' },
  );

  await app.ready();
  return app;
}
