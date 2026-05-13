import { and, eq } from 'drizzle-orm';

import { CreateOrganizationRequestType, UpdateOrganizationRequestType } from './types/request';
import { ensureUniqueSlug, generateSlug } from './utils/slug';

import { organizations, memberships, roles } from '@/db/schema/org';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
import { ALL_PERMISSIONS } from '@/shared/permissions/set';

export function organizationService(db: DatabaseClient) {
  return {
    async getOrg(userId: string, orgId: string) {
      const [membership, org] = await Promise.all([
        db.query.memberships.findFirst({
          where: and(eq(organizations.id, orgId), eq(memberships.userId, userId)),
          with: { role: true },
        }),

        db.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
        }),
      ]);

      if (!membership || !org)
        throw AppError.notFound(!membership ? 'Not a member of this organization' : 'Organization not found');

      if (org.archivedAt) throw AppError.orgArchived();

      return org;
    },
    async createOrg(userId: string, reqId: string, body: CreateOrganizationRequestType) {
      const existing = await db.query.organizations.findFirst({
        where: eq(organizations.name, body.name),
      });
      if (existing) throw AppError.duplicateOrgName();

      return await withTx(async (tx) => {
        const baseSlug = generateSlug(body.name);
        const uniqueSlug = await ensureUniqueSlug(tx, baseSlug);

        const [org] = await tx
          .insert(organizations)
          .values({
            name: body.name,
            nameLower: body.name.toLowerCase(),
            slug: uniqueSlug,
            description: body.description,
            logoUrl: body.logo,
          })
          .returning();

        const [ownerRole] = await tx
          .insert(roles)
          .values({
            name: 'owner',
            orgId: org.id,
            isOwner: true,
            permissions: ALL_PERMISSIONS,
          })
          .returning();

        await tx.insert(memberships).values({
          orgId: org.id,
          userId,
          roleId: ownerRole.id,
          joinedAt: new Date(),
        });

        await emitAudit(tx, {
          orgId: org.id,
          actorId: userId,
          event: 'org.created',
          entityType: 'org',
          entityId: org.id,
          payload: {
            name: org.name,
            slug: org.slug,
            reqId,
          },
        });

        return org;
      });
    },

    async getOnboardingStep(userId: string, orgId: string) {
      const [membership, org] = await Promise.all([
        db.query.memberships.findFirst({
          where: and(eq(organizations.id, orgId), eq(memberships.userId, userId)),
          with: { role: true },
        }),

        db.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
        }),
      ]);

      if (!membership || !org)
        throw AppError.notFound(!membership ? 'Not a member of this organization' : 'Organization not found');

      if (org.archivedAt) throw AppError.orgArchived();

      return {
        step: org.onboardingStep,
      };
    },

    async updateOrg(userId: string, orgId: string, reqId: string, body: UpdateOrganizationRequestType) {
      return await withTx(async (tx) => {
        const membership = await tx.query.memberships.findFirst({
          where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
        });

        if (!membership) throw AppError.forbidden('Not a member of this organization');

        const org = await tx.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
        });

        if (!org) throw AppError.notFound('Organization not found');
        if (org.archivedAt) throw AppError.orgArchived();

        if (body.name && body.name !== org.name) {
          const nameLower = body.name.toLowerCase();
          const existing = await tx.query.organizations.findFirst({
            where: eq(organizations.nameLower, nameLower),
          });
          if (existing && existing.id !== orgId) throw AppError.duplicateOrgName();
        }

        const [updated] = await tx
          .update(organizations)
          .set({
            name: body.name ?? org.name,
            description: body.description ?? org.description,
            logoUrl: body.logo ?? org.logoUrl,
          })
          .where(eq(organizations.id, orgId))
          .returning();

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'org.updated',
          entityType: 'org',
          entityId: orgId,
          payload: {
            name: body.name,
            description: body.description,
            reqId,
          },
        });

        return updated;
      });
    },

    async archiveOrg(userId: string, orgId: string, reqId: string) {
      return await withTx(async (tx) => {
        const membership = await tx.query.memberships.findFirst({
          where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
          with: { role: true },
        });

        if (!membership) throw AppError.forbidden('Not a member of this organization');

        if (!(membership.role as any)?.isOwner) throw AppError.forbidden('Only owners can archive organizations');

        const org = await tx.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
        });

        if (!org) throw AppError.notFound('Organization not found');

        await tx.update(organizations).set({ archivedAt: new Date() }).where(eq(organizations.id, orgId)).returning();

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'org.archived',
          entityType: 'org',
          entityId: orgId,
          payload: { reqId },
        });
      });
    },

    async skipOnboarding(userId: string, orgId: string, reqId: string) {
      return await withTx(async (tx) => {
        const org = await tx.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
        });

        if (!org) throw AppError.notFound('Organization not found');

        if (org.archivedAt) throw AppError.orgArchived();

        if (org.onboardingStep !== 'PENDING_INVITES')
          throw AppError.conflict('Invalid state transition: can only skip from PENDING_INVITES');

        const membership = await tx.query.memberships.findFirst({
          where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
          with: { role: true },
        });

        if (!membership) throw AppError.forbidden('Not a member of this organization');

        if (!(membership.role as any)?.isOwner) throw AppError.forbidden('Only owners can skip onboarding');

        const [updated] = await tx
          .update(organizations)
          .set({ onboardingStep: 'COMPLETE' })
          .where(eq(organizations.id, orgId))
          .returning();

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'org.onboarding_skipped',
          entityType: 'org',
          entityId: orgId,
          payload: {
            fromStep: 'PENDING_INVITES',
            toStep: 'COMPLETE',
            reqId,
          },
        });

        return {
          step: updated.onboardingStep || 'COMPLETE',
        };
      });
    },
  };
}
