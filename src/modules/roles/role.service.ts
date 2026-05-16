import { and, eq } from 'drizzle-orm';

import { CreateRoleRequestBody, UpdateRoleRequestBody } from './types/requests';
import { assertNoPrivilegeEscalation } from './utils/privilege';

import { memberships, organizations, roles } from '@/db/schema/org';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';

export const createRoleService = (db: DatabaseClient) => {
  return {
    async listRoles(userId: string, orgId: string) {
      const membership = await db.query.memberships.findFirst({
        where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
      });

      if (!membership) throw AppError.forbidden('Not a member of this organization');

      return await db.query.roles.findMany({
        where: eq(roles.orgId, orgId),
      });
    },
    async getRole(userId: string, orgId: string, roleId: string) {
      const membership = await db.query.memberships.findFirst({
        where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
      });

      if (!membership) throw AppError.forbidden('Not a member of this organization');

      const role = await db.query.roles.findFirst({
        where: and(eq(roles.orgId, orgId), eq(roles.id, roleId)),
      });
      if (!role) throw AppError.notFound('Role not found');

      return role;
    },
    async listPermissions(userId: string, orgId: string, roleId: string) {
      const role = await this.getRole(userId, orgId, roleId);
      return role.permissions;
    },

    async createRole(userId: string, orgId: string, reqId: string, body: CreateRoleRequestBody) {
      return await withTx(async (tx) => {
        const membership = await tx.query.memberships.findFirst({
          where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
          with: { role: true },
        });

        if (!membership) throw AppError.forbidden('Not a member of this organization');

        const callerPermissions = (membership.role as any)?.permissions || [];
        const isOwner = (membership.role as any)?.isOwner ?? false;

        if (!isOwner) assertNoPrivilegeEscalation(callerPermissions, body.permissions);

        const [role] = await tx
          .insert(roles)
          .values({
            orgId: orgId,
            name: body.name,
            permissions: body.permissions,
            isOwner: false,
          })
          .returning();

        // Check if this is the first non-Owner role (trigger onboarding advance)
        const nonOwnerCount = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.orgId, orgId), eq(roles.isOwner, false)));
        if (nonOwnerCount.length === 1) {
          await tx.update(organizations).set({ onboardingStep: 'PENDING_INVITES' }).where(eq(organizations.id, orgId));
        }

        // Emit audit event
        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'role.created',
          entityType: 'role',
          entityId: role.id,
          payload: {
            name: role.name,
            permissions: role.permissions,
            reqId,
          },
        });

        return role;
      });
    },

    async updateRole(userId: string, orgId: string, roleId: string, reqId: string, body: UpdateRoleRequestBody) {
      return await withTx(async (tx) => {
        const membership = await tx.query.memberships.findFirst({
          where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
          with: { role: true },
        });

        if (!membership) throw AppError.forbidden('Not a member of this organization');

        const callerPermissions = (membership.role as any)?.permissions || [];
        const isOwner = (membership.role as any)?.isOwner ?? false;

        const role = await db.query.roles.findFirst({
          where: and(eq(roles.orgId, orgId), eq(roles.id, roleId)),
        });
        if (!role) throw AppError.notFound('Role not found');

        if (role.isOwner) throw AppError.forbidden('Owner role cannot be modified');

        if (body.permissions && !isOwner) {
          assertNoPrivilegeEscalation(callerPermissions, body.permissions);
        }

        // Update role
        const [updated] = await tx
          .update(roles)
          .set({
            name: body.name ?? role.name,
            permissions: body.permissions ?? role.permissions,
          })
          .where(eq(roles.id, roleId))
          .returning();

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'role.updated',
          entityType: 'role',
          entityId: roleId,
          payload: {
            name: body.name,
            permissions: body.permissions,
            reqId,
          },
        });

        return updated;
      });
    },

    async deleteRole(userId: string, orgId: string, reqId: string, roleId: string) {
      return await withTx(async (tx) => {
        const membership = await tx.query.memberships.findFirst({
          where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
          with: { role: true },
        });

        if (!membership) throw AppError.forbidden('Not a member of this organization');

        const callerPermissions = (membership.role as any)?.permissions || [];
        const isOwner = (membership.role as any)?.isOwner ?? false;

        const role = await tx.query.roles.findFirst({
          where: and(eq(roles.orgId, orgId), eq(roles.id, roleId)),
        });
        if (!role) throw AppError.notFound('Role not found');

        if (role.isOwner) throw AppError.forbidden('Owner role cannot be deleted');
        if (!isOwner) assertNoPrivilegeEscalation(callerPermissions, role.permissions);

        const hasMembers = await tx.query.memberships.findFirst({ where: eq(memberships.roleId, roleId) });
        if (hasMembers) throw AppError.roleInUse();

        // Delete role
        await tx.delete(roles).where(eq(roles.id, roleId));

        // Emit audit event
        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'role.deleted',
          entityType: 'role',
          entityId: roleId,
          payload: {
            name: role.name,
            reqId,
          },
        });
      });
    },
  };
};
