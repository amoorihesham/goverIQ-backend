import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { organizationController } from './org.controller';
import { createOrganizationSchema, getOrganizationSchema, updateOrganizationSchema } from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { requirePermission } from '@/shared/permissions/guard';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';

export async function orgRoutes(fastify: FastifyInstance) {
  const controller = organizationController(db);

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:orgId',
    {
      schema: getOrganizationSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('org:read')],
    },
    controller.getOrg,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/',
    {
      schema: createOrganizationSchema,
      preHandler: [identityRequired],
    },
    controller.create,
  );

  // fastify.withTypeProvider<ZodTypeProvider>().get(
  //   '/:orgId/onboarding',
  //   {
  //     preHandler: [identityRequired, requireOnboardingStep('always')],
  //     schema: getOrganizationSchema,
  //   },
  //   controller.getOnboardingStep,
  // );

  // fastify.withTypeProvider<ZodTypeProvider>().post(
  //   '/:orgId/onboarding/skip',
  //   {
  //     schema: getOrganizationSchema,
  //     preHandler: [identityRequired, requireOnboardingStep('invitation'), requirePermission('org:update')],
  //   },
  //   controller.skipOnboarding,
  // );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/:orgId',
    {
      schema: updateOrganizationSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('org:update')],
    },
    controller.updateOrg,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:orgId',
    {
      schema: getOrganizationSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('org:archive')],
    },
    controller.archiveOrg,
  );
}
