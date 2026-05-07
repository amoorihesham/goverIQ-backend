import { and, eq } from 'drizzle-orm';
import type { DatabaseClient, Tx } from '@/shared/database/types';
import { organizations, roles, memberships } from '@/db/schema/org';

export class OrgRepository {
  /**
   * Find organization by case-insensitive name.
   */
  static async findByNameLower(db: DatabaseClient, nameLower: string) {
    return db.query.organizations.findFirst({
      where: eq(organizations.nameLower, nameLower),
    });
  }

  /**
   * Insert a new organization in a transaction.
   */
  static async insertOrg(
    tx: Tx,
    data: {
      name: string;
      nameLower: string;
      slug: string;
      description?: string | null;
      logoUrl?: string | null;
    },
  ) {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: data.name,
        nameLower: data.nameLower,
        slug: data.slug,
        description: data.description || null,
        logoUrl: data.logoUrl || null,
        quorumThreshold: '0.50',
        onboardingStep: 'PENDING_ROLES',
      })
      .returning();
    return org!;
  }

  /**
   * Insert the Owner role for an organization in a transaction.
   * Owner role has all 22 permissions and is_owner=true.
   */
  static async insertOwnerRole(tx: Tx, orgId: string, permissions: string[]) {
    const [role] = await tx
      .insert(roles)
      .values({
        orgId,
        name: 'Owner',
        isOwner: true,
        permissions,
      })
      .returning();
    return role!;
  }

  /**
   * Insert a membership in a transaction.
   */
  static async insertMembership(
    tx: Tx,
    userId: string,
    orgId: string,
    roleId: string,
  ) {
    const [membership] = await tx
      .insert(memberships)
      .values({
        userId,
        orgId,
        roleId,
      })
      .returning();
    return membership!;
  }

  /**
   * Find organization by ID with all org data.
   */
  static async findOrgById(db: DatabaseClient, orgId: string) {
    return db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });
  }

  /**
   * Find organization with membership details for a user.
   * Returns org and the user's membership/role info if they're a member.
   */
  static async findOrgWithMembershipForUser(
    db: DatabaseClient,
    orgId: string,
    userId: string,
  ) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    if (!org) return null;

    const membership = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, userId),
      ),
      with: {
        role: true,
      },
    });

    return { org, membership };
  }
}
