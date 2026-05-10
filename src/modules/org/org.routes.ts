import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { organizationController } from './org.controller';
import { createOrganizationSchema, getOrganizationSchema, updateOrganizationSchema } from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { requireOwner, requirePermission } from '@/shared/permissions/guard';
import { requireOnboardingStep } from '@/shared/http/pre-handlers/on-boarding';

export async function orgRoutes(fastify: FastifyInstance) {
  const controller = organizationController(db);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/',
    {
      preHandler: identityRequired,
      schema: createOrganizationSchema,
    },
    controller.create,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:orgId',
    {
      preHandler: [identityRequired, requireOnboardingStep('always')],
      schema: getOrganizationSchema,
    },
    controller.getOrg,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:orgId/onboarding',
    {
      preHandler: [identityRequired, requireOnboardingStep('always')],
      schema: getOrganizationSchema,
    },
    controller.getOnboardingStep,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:orgId/onboarding/skip',
    {
      schema: getOrganizationSchema,
      preHandler: [identityRequired, requireOnboardingStep('invitation'), requireOwner()],
    },
    controller.skipOnboarding,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/:orgId',
    {
      schema: updateOrganizationSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('org:update')],
    },
    controller.updateOrg,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:orgId',
    {
      schema: getOrganizationSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requireOwner()],
    },
    controller.archiveOrg,
  );
}
