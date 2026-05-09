import type { FastifyInstance } from 'fastify';

import { createMemberController } from './member.controller';
import { requireOnboardingStep } from '../org/onboarding.prehandler';

import { identityRequired } from '@/shared/auth/identity';
import { requirePermission } from '@/shared/permissions/guard';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  asignMemberRoleRequestSchema,
  invitionsRequestSchema,
  listMembersRequestSchema,
  removeMemberRequestSchema,
  revokeMemberRoleRequestSchema,
} from './schemas/zod';
import { db } from '@/shared/database/client';

export async function memberRoutes(fastify: FastifyInstance) {
  const controller = createMemberController(db, fastify.dispatcher);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/orgs/:orgId/members/invitations',

    {
      schema: invitionsRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('invitation'), requirePermission('member:invite')],
    },
    controller.sendInvitation,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/orgs/:orgId/members',
    {
      schema: listMembersRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete')],
    },
    controller.listMembers,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/orgs/:orgId/members/:memberId',
    {
      schema: removeMemberRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('member:remove')],
    },
    controller.removeMember,
  );

  fastify.withTypeProvider<ZodTypeProvider>().put(
    '/orgs/:orgId/members/:memberId/role',
    {
      schema: asignMemberRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('member:update_role')],
    },
    controller.assignMemberRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/orgs/:orgId/members/:memberId/role',
    {
      schema: revokeMemberRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('member:update_role')],
    },
    controller.revokeMemberRole,
  );
}
