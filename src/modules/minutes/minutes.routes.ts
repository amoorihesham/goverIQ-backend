import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { createMinutesController } from './minutes.controller';
import {
  createMinutesSchema,
  editMinutesSchema,
  attachResolutionSchema,
  finalizeMinutesSchema,
  appendCorrectionSchema,
  readMinutesSchema,
  exportMinutesSchema,
} from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';
import { requireOnboardingStep } from '@/shared/http/pre-handlers/on-boarding';
import { requireMembership } from '@/shared/http/pre-handlers/require-membership';
import { requirePermission } from '@/shared/permissions/guard';

export async function minutesRoutes(fastify: FastifyInstance) {
  const controller = createMinutesController(db);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/meeting/:meetingId/org/:orgId',
    {
      schema: createMinutesSchema,
      preHandler: [
        identityRequired,
        attachOrgId,
        requireOnboardingStep('complete'),
        requirePermission('minutes:create'),
      ],
    },
    controller.createMinutes,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/meeting/:meetingId/org/:orgId',
    {
      schema: readMinutesSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requireMembership],
    },
    controller.readMinutes,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/meeting/:meetingId/org/:orgId',
    {
      schema: editMinutesSchema,
      preHandler: [
        identityRequired,
        attachOrgId,
        requireOnboardingStep('complete'),
        requirePermission('minutes:update'),
      ],
    },
    controller.editMinutes,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/meeting/:meetingId/org/:orgId/resolutions',
    {
      schema: attachResolutionSchema,
      preHandler: [
        identityRequired,
        attachOrgId,
        requireOnboardingStep('complete'),
        requirePermission('minutes:update'),
      ],
    },
    controller.attachResolution,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/meeting/:meetingId/org/:orgId/finalize',
    {
      schema: finalizeMinutesSchema,
      preHandler: [
        identityRequired,
        attachOrgId,
        requireOnboardingStep('complete'),
        requirePermission('minutes:finalize'),
      ],
    },
    controller.finalizeMinutes,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/meeting/:meetingId/org/:orgId/corrections',
    {
      schema: appendCorrectionSchema,
      preHandler: [
        identityRequired,
        attachOrgId,
        requireOnboardingStep('complete'),
        requirePermission('minutes:update'),
      ],
    },
    controller.appendCorrection,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/meeting/:meetingId/org/:orgId/export',
    {
      schema: exportMinutesSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('minutes:read')],
    },
    controller.exportMinutes,
  );
}
