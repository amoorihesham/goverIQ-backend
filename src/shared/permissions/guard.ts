import { eq, and } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';

import { contextFromRequest } from '../http/context';

import { PermissionKey } from './types';

import { roles, memberships } from '@/db/schema/org';
import { db } from '@/shared/database/client';
import { AppError } from '@/shared/errors/http-error';

export function requirePermission(permission: PermissionKey) {
  return async (request: FastifyRequest) => {
    const { userId, orgId } = contextFromRequest(request);
    if (!userId || !orgId) throw AppError.create('UNAUTHORIZED');

    const [membership] = await db
      .select({
        roleId: memberships.roleId,
        isOwner: roles.isOwner,
        permissions: roles.permissions,
      })
      .from(memberships)
      .leftJoin(roles, eq(memberships.roleId, roles.id))
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
      .limit(1);
    if (!membership) throw AppError.create('FORBIDDEN', 'Not a member of the organization');

    request.orgMembership = {
      roleId: membership.roleId,
      isOwner: membership.isOwner ?? false,
      permissions: membership.permissions || [],
    };

    if (membership.isOwner) return;

    if (!membership.permissions || !membership.permissions.includes(permission))
      throw AppError.create('FORBIDDEN', 'Insufficient permissions');
  };
}
