import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { ulid } from 'ulid';

import { env } from './shared/config/env';
import { logger } from './shared/logger';

import { auditRoutes } from '@/modules/audit/public';
import { authRoutes } from '@/modules/auth/public';
import { invitionsRoutes } from '@/modules/invitions/public';
import { meetingRoutes } from '@/modules/meetings/public';
import { memberRoutes } from '@/modules/members/public';
import { minutesRoutes } from '@/modules/minutes/public';
import { orgRoutes } from '@/modules/org/public';
import { roleRoutes } from '@/modules/roles/public';
import { voteRoutes } from '@/modules/votes/public';
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

  await fastify.register(cors, {
    credentials: true,
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'DELETE'],
  });

  await fastify.register(import('@fastify/helmet'), {
    hsts:
      env.NODE_ENV === 'production'
        ? { maxAge: env.HELMET_HSTS_MAX_AGE, includeSubDomains: true, preload: true }
        : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    noSniff: true,
  });

  await fastify.register(fastifyCookie);

  await fastify.register(import('@fastify/swagger'), {
    openapi: {
      info: {
        title: 'Groven IQ API',
        description: 'Organizations, roles, members and auth API.',
        version: '1.0.0',
      },
      servers: [{ url: env.APP_BASE_URL }],
      tags: [
        { name: 'Health', description: 'Liveness and readiness probes' },
        { name: 'Auth', description: 'Registration, login and token lifecycle' },
        { name: 'Organizations', description: 'Organization CRUD' },
        { name: 'Members', description: 'Organization membership management' },
        { name: 'Roles', description: 'Role definition and permissions' },
        { name: 'Invitations', description: 'Organization invitations' },
        { name: 'Meetings', description: 'Meeting lifecycle and attendees' },
        { name: 'Voting', description: 'Formal votes, ballots and outcomes' },
        { name: 'Minutes', description: 'Meeting minutes, resolutions and corrections' },
        { name: 'Audit', description: 'Audit log query and export' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  if (env.NODE_ENV === 'development') {
    await fastify.register(import('@fastify/swagger-ui'), {
      routePrefix: '/docs',
    });
  }

  fastify.setErrorHandler(createErrorHandler(fastify));

  await fastify.register(notificationPlugin);

  await fastify.register(
    async (instance) => {
      // Group endpoints in the OpenAPI spec by module, derived from the URL prefix.
      const tagBySegment: Record<string, string> = {
        health: 'Health',
        auth: 'Auth',
        orgs: 'Organizations',
        members: 'Members',
        roles: 'Roles',
        invitations: 'Invitations',
        meetings: 'Meetings',
        votes: 'Voting',
        minutes: 'Minutes',
        audit: 'Audit',
      };
      instance.addHook('onRoute', (route) => {
        const segment = route.url.match(/^\/api\/v1\/([^/]+)/)?.[1];
        const tag = segment && tagBySegment[segment];
        if (!tag) return;
        route.schema = { ...route.schema, tags: route.schema?.tags ?? [tag] };
      });

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

  return fastify;
}
