import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { createRoleController } from './role.controller';
import {
  createRoleRequestSchema,
  deleteRoleRequestSchema,
  getRoleDetailsRequestSchema,
  listPermissionsInRoleRequestSchema,
  listRolesInOrganizationRequestSchema,
  updateRoleRequestSchema,
} from './schemas/zod';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';
import { requirePermission } from '@/shared/permissions/guard';

export async function roleRoutes(fastify: FastifyInstance) {
  const controller = createRoleController(db);

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/org/:orgId',
    {
      schema: listRolesInOrganizationRequestSchema,
      preHandler: [identityRequired, attachOrgId, requirePermission('role:read')],
    },
    controller.listRoles,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:roleId/org/:orgId',
    {
      schema: getRoleDetailsRequestSchema,
      preHandler: [identityRequired, requirePermission('role:read')],
    },
    controller.getRoleDetails,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:roleId/org/:orgId/permissions',
    {
      schema: listPermissionsInRoleRequestSchema,
      preHandler: [identityRequired, requirePermission('role:read')],
    },
    controller.listPermissions,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/org/:orgId',
    {
      schema: createRoleRequestSchema,
      preHandler: [identityRequired, requirePermission('role:create')],
    },
    controller.createRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/:roleId/org/:orgId',
    {
      schema: updateRoleRequestSchema,
      preHandler: [identityRequired, requirePermission('role:update')],
    },
    controller.updateRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/:roleId/org/:orgId',
    {
      schema: deleteRoleRequestSchema,
      preHandler: [identityRequired, requirePermission('role:delete')],
    },
    controller.deleteRole,
  );
}
