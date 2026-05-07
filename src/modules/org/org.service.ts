import { AppError } from '@/shared/errors/http-error';
import { withTx } from '@/shared/database/transaction';
import { emitAudit } from '@/shared/audit/emitter';
import { db } from '@/shared/database/client';
import { OrgRepository } from './org.repository';
import { ensureUniqueSlug, generateSlug } from './slug';
import { z } from 'zod';

// All permissions available in the system
const ALL_PERMISSIONS = [
  'org:read',
  'org:update',
  'org:archive',
  'role:create',
  'role:read',
  'role:update',
  'role:delete',
  'member:invite',
  'member:read',
  'member:assign',
  'member:remove',
  'member:revoke',
  'audit:read',
  'billing:read',
  'billing:update',
  'settings:read',
  'settings:update',
  'webhook:create',
  'webhook:read',
  'webhook:update',
  'webhook:delete',
];

const CreateOrgInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
});

type CreateOrgInput = z.infer<typeof CreateOrgInput>;

export class OrgService {
  /**
   * Create a new organization atomically with Owner role and creator membership.
   */
  static async createOrg(userId: string, body: CreateOrgInput) {
    const input = CreateOrgInput.parse(body);

    // Check for duplicate name (case-insensitive)
    const nameLower = input.name.toLowerCase();
    const existing = await OrgRepository.findByNameLower(db, nameLower);
    if (existing) {
      throw AppError.duplicateOrgName();
    }

    // Atomic transaction: create org + Owner role + membership + audit
    return await withTx(async (tx) => {
      // Generate and ensure unique slug
      const baseSlug = generateSlug(input.name);
      const uniqueSlug = await ensureUniqueSlug(tx, baseSlug);

      // Insert organization
      const org = await OrgRepository.insertOrg(tx, {
        name: input.name,
        nameLower,
        slug: uniqueSlug,
        description: input.description,
        logoUrl: input.logoUrl,
      });

      // Insert Owner role with all permissions
      const ownerRole = await OrgRepository.insertOwnerRole(
        tx,
        org.id,
        ALL_PERMISSIONS,
      );

      // Insert creator's membership as Owner
      await OrgRepository.insertMembership(tx, userId, org.id, ownerRole.id);

      // Emit audit event
      await emitAudit(tx, {
        orgId: org.id,
        actorId: userId,
        event: 'org.created',
        entityType: 'org',
        entityId: org.id,
        payload: {
          name: org.name,
          slug: org.slug,
        },
      });

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
        logoUrl: org.logoUrl,
        onboardingStep: org.onboardingStep,
        quorumThreshold: org.quorumThreshold,
        archivedAt: org.archivedAt,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      };
    });
  }

  /**
   * Get organization by ID after verifying caller is a member.
   */
  static async getOrg(userId: string, orgId: string) {
    const result = await OrgRepository.findOrgWithMembershipForUser(
      db,
      orgId,
      userId,
    );

    if (!result) {
      throw AppError.notFound('Organization not found');
    }

    const { org, membership } = result;

    if (!membership) {
      throw AppError.forbidden('Not a member of this organization');
    }

    // Check if org is archived
    if (org.archivedAt) {
      throw AppError.orgArchived();
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      logoUrl: org.logoUrl,
      onboardingStep: org.onboardingStep,
      quorumThreshold: org.quorumThreshold,
      archivedAt: org.archivedAt,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  /**
   * Get current onboarding step for an organization.
   */
  static async getOnboardingStep(userId: string, orgId: string) {
    const result = await OrgRepository.findOrgWithMembershipForUser(
      db,
      orgId,
      userId,
    );

    if (!result) {
      throw AppError.notFound('Organization not found');
    }

    const { org, membership } = result;

    if (!membership) {
      throw AppError.forbidden('Not a member of this organization');
    }

    if (org.archivedAt) {
      throw AppError.orgArchived();
    }

    return {
      step: org.onboardingStep,
    };
  }

  /**
   * Update organization name and/or description.
   */
  static async updateOrg(
    userId: string,
    orgId: string,
    body: { name?: string; description?: string; logoUrl?: string },
  ) {
    return await withTx(async (tx) => {
      // Verify caller is a member
      const membership = await tx.query.memberships.findFirst({
        where: (m, { and, eq }) =>
          and(eq(m.userId, userId), eq(m.orgId, orgId)),
      });

      if (!membership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      // Get current org
      const org = await tx.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.id, orgId),
      });

      if (!org) {
        throw AppError.notFound('Organization not found');
      }

      if (org.archivedAt) {
        throw AppError.orgArchived();
      }

      // Check for name conflict if changing name
      if (body.name && body.name !== org.name) {
        const nameLower = body.name.toLowerCase();
        const existing = await OrgRepository.findByNameLower(db, nameLower);
        if (existing && existing.id !== orgId) {
          throw AppError.duplicateOrgName();
        }
      }

      // Update org
      const updateData: {
        name?: string;
        nameLower?: string;
        description?: string;
        logoUrl?: string;
      } = {};
      if (body.name) {
        updateData.name = body.name;
        updateData.nameLower = body.name.toLowerCase();
      }
      if (body.description !== undefined) {
        updateData.description = body.description;
      }
      if (body.logoUrl !== undefined) {
        updateData.logoUrl = body.logoUrl;
      }

      const updated = await OrgRepository.updateOrg(tx, orgId, updateData);

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'org.updated',
        entityType: 'org',
        entityId: orgId,
        payload: {
          name: body.name,
          description: body.description,
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        description: updated.description,
        logoUrl: updated.logoUrl,
        onboardingStep: updated.onboardingStep,
        quorumThreshold: updated.quorumThreshold,
        archivedAt: updated.archivedAt,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    });
  }

  /**
   * Archive organization (soft delete). Owner-only.
   */
  static async archiveOrg(userId: string, orgId: string) {
    return await withTx(async (tx) => {
      // Verify caller is owner
      const membership = await tx.query.memberships.findFirst({
        where: (m, { and, eq }) =>
          and(eq(m.userId, userId), eq(m.orgId, orgId)),
        with: { role: true },
      });

      if (!membership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      if (!membership.role?.isOwner) {
        throw AppError.forbidden('Only owners can archive organizations');
      }

      // Get current org
      const org = await tx.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.id, orgId),
      });

      if (!org) {
        throw AppError.notFound('Organization not found');
      }

      // Archive
      await OrgRepository.archiveOrg(tx, orgId);

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'org.archived',
        entityType: 'org',
        entityId: orgId,
        payload: {},
      });
    });
  }

  /**
   * Skip from PENDING_INVITES to COMPLETE (Owner-only).
   * Throws CONFLICT if current step is not PENDING_INVITES.
   */
  static async skipOnboarding(userId: string, orgId: string) {
    return await withTx(async (tx) => {
      const { memberships, roles, organizations } = await import('@/db/schema/org');
      const { and, eq } = await import('drizzle-orm');

      // Get current org state and verify step
      const org = await tx.query.organizations.findFirst({
        where: (o) => eq(o.id, orgId),
      });

      if (!org) {
        throw AppError.notFound('Organization not found');
      }

      if (org.archivedAt) {
        throw AppError.orgArchived();
      }

      // Verify current step is PENDING_INVITES
      if (org.onboardingStep !== 'PENDING_INVITES') {
        throw AppError.conflict(
          'Invalid state transition: can only skip from PENDING_INVITES',
        );
      }

      // Verify caller is owner
      const membership = await tx.query.memberships.findFirst({
        where: (m) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
        with: { role: true },
      });

      if (!membership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      if (!membership.role?.isOwner) {
        throw AppError.forbidden('Only owners can skip onboarding');
      }

      // Update onboarding step to COMPLETE
      const updated = await tx
        .update(organizations)
        .set({ onboardingStep: 'COMPLETE' })
        .where(eq(organizations.id, orgId))
        .returning();

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'org.onboarding_skipped',
        entityType: 'org',
        entityId: orgId,
        payload: {
          fromStep: 'PENDING_INVITES',
          toStep: 'COMPLETE',
        },
      });

      return {
        step: updated[0]?.onboardingStep || 'COMPLETE',
      };
    });
  }
}
