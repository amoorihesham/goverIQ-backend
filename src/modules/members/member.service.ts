import { and, eq } from 'drizzle-orm';

import { memberships } from '@/db/schema/org';
import { assertNoPrivilegeEscalation } from '@/modules/roles/public';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
<<<<<<< HEAD
import type { NotificationDispatcher } from '@/shared/notifications/dispatcher';
=======
>>>>>>> main

export const membersService = (db: DatabaseClient) => {
  return {
    async getMembersInOrganization(userId: string, orgId: string) {
      const membership = await db.query.memberships.findFirst({
        where: (f, { and, eq }) => and(eq(f.userId, userId), eq(f.orgId, orgId)),
      });
      if (!membership) throw AppError.forbidden('Not a member of this organization.');

      return db.query.memberships.findMany({ where: (f, { eq }) => eq(f.orgId, orgId), with: { role: true } });
    },

    async getMemberDetails(userId: string, orgId: string, memberId: string) {
      const membership = await db.query.memberships.findFirst({
        where: (f, { and, eq }) => and(eq(f.userId, userId), eq(f.orgId, orgId)),
      });
      if (!membership) throw AppError.forbidden('Not a member of this organization.');
      return db.query.memberships.findFirst({
        where: (f, { and, eq }) => and(eq(f.orgId, orgId), eq(f.userId, memberId)),
        with: { role: true },
      });
    },

    async assignMemberRole(userId: string, orgId: string, memberId: string, roleId: string, reqId: string) {
      return await withTx(async (tx) => {
        const callerMembership = await tx.query.memberships.findFirst({
          where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
          with: { role: true },
        });
        if (!callerMembership) throw AppError.forbidden('Not a member of this organization');

        const role = await tx.query.roles.findFirst({
          where: (f, { and, eq }) => and(eq(f.orgId, orgId), eq(f.id, roleId)),
        });
        if (!role) throw AppError.notFound('Role not found');

        const callerPermissions = (callerMembership.role as any)?.permissions ?? [];
        const callerIsOwner = (callerMembership.role as any)?.isOwner ?? false;

        if (role.isOwner) throw AppError.forbidden('can not assign owner role.');
        if (!callerIsOwner) assertNoPrivilegeEscalation(callerPermissions, role.permissions);

        const targetMembership = await tx.query.memberships.findFirst({
          where: (f, { and, eq }) => and(eq(f.orgId, orgId), eq(f.userId, memberId)),
        });
        if (!targetMembership) throw AppError.notFound('Membership not found');

        const [updated] = await tx
          .update(memberships)
          .set({
            roleId,
          })
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, memberId)))
          .returning();

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'member.role_assigned',
          entityType: 'membership',
          entityId: memberId,
          payload: {
            userId: targetMembership.userId,
            roleId,
            reqId,
          },
        });

        return {
          id: updated.id,
          userId: updated.userId,
          orgId: updated.orgId,
          roleId: updated.roleId,
        };
      });
    },

    async revokeMemberRole(userId: string, orgId: string, memberId: string, reqId: string) {
      return await withTx(async (tx) => {
        const callerMembership = await tx.query.memberships.findFirst({
          where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
          with: { role: true },
        });
        if (!callerMembership) throw AppError.forbidden('Not a member of this organization');

        const targetMembership = await tx.query.memberships.findFirst({
          where: (f, { and, eq }) => and(eq(f.orgId, orgId), eq(f.userId, memberId)),
        });
        if (!targetMembership) throw AppError.notFound('Membership not found');

        const [updated] = await tx
          .update(memberships)
          .set({
            roleId: null,
          })
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, memberId)))
          .returning();

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'member.role_revoked',
          entityType: 'membership',
          entityId: memberId,
          payload: {
            userId: targetMembership.userId,
            reqId,
          },
        });

        return {
          id: updated.id,
          userId: updated.userId,
          orgId: updated.orgId,
          roleId: updated.roleId,
        };
      });
    },

    async removeMember(userId: string, orgId: string, memberId: string, reqId: string) {
      return await withTx(async (tx) => {
        const callerMembership = await tx.query.memberships.findFirst({
          where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
          with: { role: true },
        });
        if (!callerMembership) throw AppError.forbidden('Not a member of this organization');

        const targetMembership = await tx.query.memberships.findFirst({
          where: (f, { and, eq }) => and(eq(f.orgId, orgId), eq(f.userId, memberId)),
        });
        if (!targetMembership) throw AppError.notFound('Membership not found');

        const [updated] = await tx
          .delete(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, memberId)))
          .returning();

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'member.removed',
          entityType: 'membership',
          entityId: memberId,
          payload: {
            userId: targetMembership.userId,
            reqId,
          },
        });

        return {
          id: updated.id,
          userId: updated.userId,
          orgId: updated.orgId,
          roleId: updated.roleId,
        };
      });
    },
  };
};
