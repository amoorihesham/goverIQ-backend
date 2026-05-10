import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { requireOnboardingStep } from '../org/onboarding.prehandler';

import { createMemberController } from './member.controller';
import {
  asignMemberRoleRequestSchema,
  invitionsRequestSchema,
  listMembersRequestSchema,
  removeMemberRequestSchema,
  revokeMemberRoleRequestSchema,
} from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { requirePermission } from '@/shared/permissions/guard';

export async function memberRoutes(fastify: FastifyInstance) {
  const controller = createMemberController(db, fastify.dispatcher);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/invitations',

    {
      schema: invitionsRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('invitation'), requirePermission('member:invite')],
    },
    controller.sendInvitation,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/members',
    {
      schema: listMembersRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete')],
    },
    controller.listMembers,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:memberId',
    {
      schema: removeMemberRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('member:remove')],
    },
    controller.removeMember,
  );

  fastify.withTypeProvider<ZodTypeProvider>().put(
    '/:memberId/role',
    {
      schema: asignMemberRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('member:update_role')],
    },
    controller.assignMemberRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:memberId/role',
    {
      schema: revokeMemberRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('member:update_role')],
    },
    controller.revokeMemberRole,
  );
}
