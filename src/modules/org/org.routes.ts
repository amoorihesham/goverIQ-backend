import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { requireOnboardingStep } from './onboarding.prehandler';
import { organizationController } from './org.controller';
import {
  createOrganizationSchema,
  getOrganizationSchema,
  updateOrganizationSchema,
} from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { requireOwner, requirePermission } from '@/shared/permissions/guard';

export async function orgRoutes(fastify: FastifyInstance) {
  const controller = organizationController(db);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/orgs',
    {
      preHandler: identityRequired,
      schema: createOrganizationSchema,
    },
    controller.create,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/orgs/:orgId',
    {
      preHandler: [identityRequired, requireOnboardingStep('always')],
      schema: getOrganizationSchema,
    },
    controller.getOrg,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/orgs/:orgId/onboarding',
    {
      preHandler: [identityRequired, requireOnboardingStep('always')],
      schema: getOrganizationSchema,
    },
    controller.getOnboardingStep,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/orgs/:orgId/onboarding/skip',
    {
      schema: getOrganizationSchema,
      preHandler: [identityRequired, requireOnboardingStep('invitation'), requireOwner()],
    },
    controller.skipOnboarding,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/orgs/:orgId',
    {
      schema: updateOrganizationSchema,
      preHandler: [
        identityRequired,
        requireOnboardingStep('complete'),
        requirePermission('org:update'),
      ],
    },
    controller.updateOrg,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/orgs/:orgId',
    {
      schema: getOrganizationSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requireOwner()],
    },
    controller.archiveOrg,
  );
}
