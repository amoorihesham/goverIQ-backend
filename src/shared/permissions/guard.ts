import { eq, and } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';

import type { PermissionKey } from './set';

import { roles, memberships } from '@/db/schema/org';
import { verifyAccessToken } from '@/shared/auth/jwt';
import { db } from '@/shared/database/client';
import { AppError } from '@/shared/errors/http-error';
import { contextFromRequest } from '../http/context';

export function requirePermission(permission: PermissionKey) {
  return async (request: FastifyRequest) => {
    const { userId, orgId } = contextFromRequest(request);
    if (!userId || !orgId) throw AppError.unauthorized();

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
    if (!membership) throw AppError.forbidden('Not a member of this organization');

    request.orgMembership = {
      roleId: membership.roleId,
      isOwner: membership.isOwner ?? false,
      permissions: membership.permissions || [],
    };

    if (membership.isOwner) return;

    if (!membership.permissions || !membership.permissions.includes(permission))
      throw AppError.forbidden('Insufficient permissions');
  };
}
