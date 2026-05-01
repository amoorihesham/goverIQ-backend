import { eq, and } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';

import type { PermissionKey } from './set';

import { roles, memberships } from '@/db/schema/org';
import { verifyAccessToken } from '@/shared/auth/jwt';
import { db } from '@/shared/database/client';
import { AppError } from '@/shared/errors/http-error';


export function requirePermission(permission: PermissionKey) {
  return async (request: FastifyRequest) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw AppError.unauthorized('Missing or invalid Authorization header');
      }

      const token = authHeader.slice(7);
      const payload = await verifyAccessToken(token);

      const orgId = (request.params as Record<string, unknown>).orgId as string | undefined;
      if (!orgId) {
        throw AppError.forbidden('Organization ID required');
      }

      const membership = await db
        .select({
          roleId: memberships.roleId,
          isOwner: roles.isOwner,
          permissions: roles.permissions,
        })
        .from(memberships)
        .leftJoin(roles, eq(memberships.roleId, roles.id))
        .where(and(eq(memberships.userId, payload.sub), eq(memberships.orgId, orgId)))
        .limit(1);

      if (!membership.length || !membership[0]) {
        throw AppError.forbidden('Not a member of this organization');
      }

      const [memberData] = membership;

      if (memberData.isOwner) {
        return;
      }

      if (!memberData.permissions || !memberData.permissions.includes(permission)) {
        throw AppError.forbidden('Insufficient permissions');
      }
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw AppError.unauthorized('Token verification failed');
    }
  };
}
