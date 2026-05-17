import { and, eq } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';

import { roles, memberships } from '@/db/schema/org';
import { db } from '@/shared/database/client';
import { AppError } from '@/shared/errors/http-error';
import { contextFromRequest } from '@/shared/http/context';

export async function requireMembership(request: FastifyRequest): Promise<void> {
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
}
