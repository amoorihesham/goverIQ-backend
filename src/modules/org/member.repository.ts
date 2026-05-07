import { and, eq } from 'drizzle-orm';

import { memberships, invitations, roles } from '@/db/schema/org';
import type { DatabaseClient, Tx } from '@/shared/database/types';

export class MemberRepository {
  /**
   * Find a pending invitation by org and email.
   */
  static async findPendingInviteByOrgEmail(
    db: DatabaseClient,
    orgId: string,
    email: string,
  ) {
    return db.query.invitations.findFirst({
      where: and(
        eq(invitations.orgId, orgId),
        eq(invitations.email, email),
        eq(invitations.status, 'PENDING'),
      ),
    });
  }

  /**
   * Insert a new invitation in a transaction.
   */
  static async insertInvitation(
    tx: Tx,
    data: {
      orgId: string;
      email: string;
      roleId: string;
      tokenHash: string;
      expiresAt: Date;
    },
  ) {
    const [invitation] = await tx
      .insert(invitations)
      .values({
        orgId: data.orgId,
        email: data.email,
        roleId: data.roleId,
        tokenHash: data.tokenHash,
        status: 'PENDING',
        expiresAt: data.expiresAt,
      })
      .returning();
    return invitation!;
  }

  /**
   * Find an invitation by token hash.
   */
  static async findInvitationByTokenHash(db: DatabaseClient, tokenHash: string) {
    return db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, tokenHash),
      with: {
        role: true,
        org: true,
      },
    });
  }

  /**
   * Update invitation status in a transaction.
   */
  static async updateInvitationStatus(
    tx: Tx,
    invitationId: string,
    status: 'ACCEPTED' | 'DECLINED',
  ) {
    const [updated] = await tx
      .update(invitations)
      .set({ status })
      .where(eq(invitations.id, invitationId))
      .returning();
    return updated!;
  }

  /**
   * Insert or update membership in a transaction.
   */
  static async upsertMembership(
    tx: Tx,
    userId: string,
    orgId: string,
    roleId: string,
  ) {
    // Check if membership exists
    const existing = await tx.query.memberships.findFirst({
      where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
    });

    if (existing) {
      // Update existing membership
      const [updated] = await tx
        .update(memberships)
        .set({ roleId })
        .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
        .returning();
      return updated!;
    } else {
      // Insert new membership
      const [inserted] = await tx
        .insert(memberships)
        .values({ userId, orgId, roleId })
        .returning();
      return inserted!;
    }
  }

  /**
   * List members in an org with cursor pagination.
   */
  static async listMembers(
    db: DatabaseClient,
    orgId: string,
    cursor?: string,
    limit: number = 20,
  ) {
    // Implement cursor pagination
    // For now, return all members for the org
    return db.query.memberships.findMany({
      where: eq(memberships.orgId, orgId),
      with: {
        user: true,
        role: true,
      },
      limit: limit + 1, // Get one extra to know if there's a next page
    });
  }

  /**
   * Delete a membership in a transaction.
   */
  static async deleteMembership(tx: Tx, membershipId: string) {
    await tx.delete(memberships).where(eq(memberships.id, membershipId));
  }

  /**
   * Update member's role in a transaction.
   */
  static async updateMemberRole(tx: Tx, membershipId: string, roleId: string) {
    const [updated] = await tx
      .update(memberships)
      .set({ roleId })
      .where(eq(memberships.id, membershipId))
      .returning();
    return updated!;
  }

  /**
   * Clear member's role in a transaction.
   */
  static async clearMemberRole(tx: Tx, membershipId: string) {
    const [updated] = await tx
      .update(memberships)
      .set({ roleId: null })
      .where(eq(memberships.id, membershipId))
      .returning();
    return updated!;
  }

  /**
   * Count how many owners are in an organization.
   */
  static async countOwnersInOrg(db: DatabaseClient, orgId: string) {
    const result = await db
      .select()
      .from(memberships)
      .innerJoin(roles, eq(memberships.roleId, roles.id))
      .where(and(eq(memberships.orgId, orgId), eq(roles.isOwner, true)));
    return result.length;
  }
}
