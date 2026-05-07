import { and, eq } from 'drizzle-orm';
import type { DatabaseClient, Tx } from '@/shared/database/types';
import { memberships, invitations } from '@/db/schema/org';

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
      where: (i, { and, eq }) =>
        and(
          eq(i.orgId, orgId),
          eq(i.email, email),
          eq(i.status, 'PENDING'),
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
      where: (i, { eq }) => eq(i.tokenHash, tokenHash),
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
      .where((i) => eq(i.id, invitationId))
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
      where: (m, { and, eq }) =>
        and(eq(m.userId, userId), eq(m.orgId, orgId)),
    });

    if (existing) {
      // Update existing membership
      const [updated] = await tx
        .update(memberships)
        .set({ roleId })
        .where(
          (m, { and, eq }) =>
            and(eq(m.userId, userId), eq(m.orgId, orgId)),
        )
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
      where: (m, { eq }) => eq(m.orgId, orgId),
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
    await tx.delete(memberships).where((m) => eq(m.id, membershipId));
  }

  /**
   * Update member's role in a transaction.
   */
  static async updateMemberRole(tx: Tx, membershipId: string, roleId: string) {
    const [updated] = await tx
      .update(memberships)
      .set({ roleId })
      .where((m) => eq(m.id, membershipId))
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
      .where((m) => eq(m.id, membershipId))
      .returning();
    return updated!;
  }

  /**
   * Count how many owners are in an organization.
   */
  static async countOwnersInOrg(db: DatabaseClient, orgId: string) {
    const { roles } = await import('@/db/schema/org');
    const result = await db
      .select()
      .from(memberships)
      .innerJoin(roles, (m, r) => eq(m.roleId, r.id))
      .where((m, r) =>
        and(eq(m.orgId, orgId), eq(r.isOwner, true)),
      );
    return result.length;
  }
}
