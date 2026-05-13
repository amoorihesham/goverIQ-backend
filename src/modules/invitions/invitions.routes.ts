import { FastifyInstance } from 'fastify';
import { invitionsController } from './invitions.controller';
import { db } from '@/shared/database/client';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { identityRequired } from '@/shared/auth/identity';
import { requirePermission } from '@/shared/permissions/guard';
import {
  createInvitationSchema,
  deleteInvitationSchema,
  getInvitationSchema,
  listInvitionsSchema,
} from './schemas/zod';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';

export async function invitionsRoutes(fastify: FastifyInstance) {
  const controller = invitionsController(db, fastify.dispatcher);

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/org/:orgId',
    {
      schema: listInvitionsSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('invitation:read')],
    },
    controller.listInvitions,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:invitationId/org/:orgId',
    {
      schema: getInvitationSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('invitation:read')],
    },
    controller.getInvitation,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/org/:orgId',
    {
      schema: createInvitationSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('invitation:create')],
    },
    controller.createInvitation,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:invitationId/org/:orgId',
    {
      schema: deleteInvitationSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('invitation:delete')],
    },
    controller.deleteInvitation,
  );
}
