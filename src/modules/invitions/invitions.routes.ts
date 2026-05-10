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

export async function invitionsRoutes(fastify: FastifyInstance) {
  const controller = invitionsController(db, fastify.dispatcher);

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:orgId',
    {
      schema: listInvitionsSchema,
      preHandler: [identityRequired, requirePermission('invitation:read')],
    },
    controller.listInvitions,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:orgId/:invitationId',
    {
      schema: getInvitationSchema,
      preHandler: [identityRequired, requirePermission('invitation:read')],
    },
    controller.getInvitation,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/',
    {
      schema: createInvitationSchema,
      preHandler: [identityRequired, requirePermission('invitation:create')],
    },
    controller.createInvitation,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:invitationId',
    {
      schema: deleteInvitationSchema,
      preHandler: [identityRequired, requirePermission('invitation:delete')],
    },
    controller.deleteInvitation,
  );
}
