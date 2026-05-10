import type { FastifyInstance } from 'fastify';

import { createRoleController } from './role.controller';

import { identityRequired } from '@/shared/auth/identity';
import { requirePermission } from '@/shared/permissions/guard';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createRoleRequestSchema,
  getRoleRequestSchema,
  listPermissionRequestSchema,
  listRolesRequestSchema,
  updateRoleRequestSchema,
} from './schemas/zod';
import { db } from '@/shared/database/client';
import { requireOnboardingStep } from '@/shared/http/pre-handlers/on-boarding';

export async function roleRoutes(fastify: FastifyInstance) {
  const controller = createRoleController(db);

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/orgs/:orgId/roles/permissions',
    {
      schema: listPermissionRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('role_creation')],
    },
    controller.listPermissions,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/orgs/:orgId/roles',
    {
      schema: createRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('role_creation'), requirePermission('role:create')],
    },
    controller.createRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/roles',
    {
      schema: listRolesRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('invitation')],
    },
    controller.listRoles,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/orgs/:orgId/roles/:roleId',
    {
      schema: getRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('invitation')],
    },
    controller.getRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/orgs/:orgId/roles/:roleId',
    {
      schema: updateRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('role:update')],
    },
    controller.updateRole,
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/orgs/:orgId/roles/:roleId',
    {
      schema: getRoleRequestSchema,
      preHandler: [identityRequired, requireOnboardingStep('complete'), requirePermission('role:delete')],
    },
    controller.deleteRole,
  );
}
