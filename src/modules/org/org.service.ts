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
}
