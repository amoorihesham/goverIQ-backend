import type { FastifyInstance } from 'fastify';

import { requireOnboardingStep } from './onboarding.prehandler';
import { RoleController } from './role.controller';

import { identityRequired } from '@/shared/auth/identity';
import { requirePermission } from '@/shared/permissions/guard';

export async function roleRoutes(fastify: FastifyInstance) {
  // GET /api/v1/orgs/:orgId/roles/permissions - List permissions
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/roles/permissions',
    {
      preHandler: [identityRequired, requireOnboardingStep('role_creation')],
    },
    RoleController.listPermissions,
  );

  // POST /api/v1/orgs/:orgId/roles - Create role
  fastify.post<{
    Params: { orgId: string };
    Body: { name: string; permissions: string[] };
  }>(
    '/orgs/:orgId/roles',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('role_creation'),
        requirePermission('role:create'),
      ],
    },
    RoleController.createRole,
  );

  // GET /api/v1/orgs/:orgId/roles - List roles
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/roles',
    {
      preHandler: [identityRequired, requireOnboardingStep('invitation')],
    },
    RoleController.listRoles,
  );

  // GET /api/v1/orgs/:orgId/roles/:roleId - Get specific role
  fastify.get<{ Params: { orgId: string; roleId: string } }>(
    '/orgs/:orgId/roles/:roleId',
    {
      preHandler: [identityRequired, requireOnboardingStep('invitation')],
    },
    RoleController.getRole,
  );

  // PATCH /api/v1/orgs/:orgId/roles/:roleId - Update role
  fastify.patch<{
    Params: { orgId: string; roleId: string };
    Body: { name?: string; permissions?: string[] };
  }>(
    '/orgs/:orgId/roles/:roleId',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('complete'),
        requirePermission('role:update'),
      ],
    },
    RoleController.updateRole,
  );

  // DELETE /api/v1/orgs/:orgId/roles/:roleId - Delete role
  fastify.delete<{ Params: { orgId: string; roleId: string } }>(
    '/orgs/:orgId/roles/:roleId',
    {
      preHandler: [
        identityRequired,
        requireOnboardingStep('complete'),
        requirePermission('role:delete'),
      ],
    },
    RoleController.deleteRole,
  );
}
