import fastifyCookie from '@fastify/cookie';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { buildApp } from '@/app';
import { authRoutes } from '@/modules/auth/public';
import { invitionsRoutes } from '@/modules/invitions/public';
import { memberRoutes } from '@/modules/members/public';
import { orgRoutes } from '@/modules/org/public';
import { roleRoutes } from '@/modules/roles/public';
import { auditRoutes } from '@/modules/audit/public';
import { voteRoutes } from '@/modules/votes/public';
import { minutesRoutes } from '@/modules/minutes/public';
import { meetingRoutes } from '@/modules/meetings/public';
import { env } from '@/shared/config/env';
import { db } from '@/shared/database/client';
import { runMigrations } from '@/shared/database/migrate';
import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';
import { notificationPlugin } from '@/shared/notifications/plugin';

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
      await instance.register(meetingRoutes, { prefix: '/meetings' });
      await instance.register(voteRoutes, { prefix: '/votes' });
      await instance.register(minutesRoutes, { prefix: '/minutes' });
      await instance.register(auditRoutes, { prefix: '/audit' });
    },
    { prefix: '/api/v1' },
  );

  await app.ready();
  return app;
}

export async function buildAppTestServer() {
  await runMigrations(db);
  const app = await buildApp();
  await app.ready();
  return app;
}
