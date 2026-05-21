import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { invitionsController } from './invitions.controller';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  declineInvitationSchema,
  deleteInvitationSchema,
  getInvitationSchema,
  listInvitionsSchema,
} from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { tryIdentity } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';
import { requirePermission } from '@/shared/permissions/guard';

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

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:token/accept',
    {
      schema: acceptInvitationSchema,
      preHandler: [tryIdentity],
    },
    controller.acceptInvitation,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:token/decline',
    { schema: declineInvitationSchema },
    controller.declineInvitation,
  );
}
