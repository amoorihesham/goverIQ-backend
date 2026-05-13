import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { createMemberController } from './member.controller';
import {
  asignMemberRoleRequestSchema,
  getMemberDetailsRequestSchema,
  getMembersInOrganizationRequestSchema,
  removeMemberRequestSchema,
  revokeMemberRoleRequestSchema,
} from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { requirePermission } from '@/shared/permissions/guard';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';

export async function memberRoutes(fastify: FastifyInstance) {
  const controller = createMemberController(db, fastify.dispatcher);

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/org/:orgId',
    {
      schema: getMembersInOrganizationRequestSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('member:read')],
    },
    controller.getMembersInOrganization,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    ':memberId/org/:orgId',
    {
      schema: getMemberDetailsRequestSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('member:read')],
    },
    controller.getMemberDetails,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/:memberId/org/:orgId',

    {
      schema: asignMemberRoleRequestSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('member:update_role')],
    },
    controller.assignMemberRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:memberId/org/:orgId',
    {
      schema: removeMemberRequestSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('member:remove')],
    },
    controller.removeMember,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:memberId/org/:orgId/revoke-role',
    {
      schema: revokeMemberRoleRequestSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('member:update_role')],
    },
    controller.revokeMemberRole,
  );
}
