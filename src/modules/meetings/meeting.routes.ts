import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';


import { createMeetingController } from './meeting.controller';
import { requireStatusTransitionPermission } from './pre-handlers/status-permission';
import {
  createMeetingSchema,
  transitionStatusSchema,
  addAttendeesSchema,
  removeAttendeeSchema,
  listMeetingsSchema,
  getMeetingSchema,
  updateMeetingSchema,
} from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';
import { requireOnboardingStep } from '@/shared/http/pre-handlers/on-boarding';
import { requirePermission } from '@/shared/permissions/guard';

export async function meetingRoutes(fastify: FastifyInstance) {
  const controller = createMeetingController(db);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/org/:orgId',
    {
      schema: createMeetingSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:create')],
    },
    controller.createMeeting,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/org/:orgId',
    {
      schema: listMeetingsSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:read')],
    },
    controller.listMeetings,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:meetingId/org/:orgId',
    {
      schema: getMeetingSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:read')],
    },
    controller.getMeeting,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/:meetingId/org/:orgId',
    {
      schema: updateMeetingSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:update')],
    },
    controller.updateMeeting,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/:meetingId/org/:orgId/status',
    {
      schema: transitionStatusSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requireStatusTransitionPermission],
    },
    controller.transitionStatus,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:meetingId/org/:orgId/attendees',
    {
      schema: addAttendeesSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:update')],
    },
    controller.addAttendees,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:meetingId/org/:orgId/attendees/:memberId',
    {
      schema: removeAttendeeSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:update')],
    },
    controller.removeAttendee,
  );
}
