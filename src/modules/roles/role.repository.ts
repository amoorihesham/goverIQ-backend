import { and, eq } from 'drizzle-orm';

import { roles, memberships } from '@/db/schema/org';
import type { DatabaseClient, Tx } from '@/shared/database/types';

export class RoleRepository {
  /**
   * List all roles for an organization.
   */
  static async listRoles(db: DatabaseClient, orgId: string) {
    return db.query.roles.findMany({
      where: eq(roles.orgId, orgId),
    });
  }

  /**
   * Find a specific role by ID within an org.
   */
  static async findRoleById(db: DatabaseClient, orgId: string, roleId: string) {
    return db.query.roles.findFirst({
      where: and(eq(roles.orgId, orgId), eq(roles.id, roleId)),
    });
  }

  /**
   * Insert a new role in a transaction.
   */
  static async insertRole(
    tx: Tx,
    data: {
      orgId: string;
      name: string;
      permissions: string[];
      isOwner?: boolean;
    },
  ) {
    const [role] = await tx
      .insert(roles)
      .values({
        orgId: data.orgId,
        name: data.name,
        permissions: data.permissions,
        isOwner: data.isOwner ?? false,
      })
      .returning();
    return role!;
  }

  /**
   * Update a role's permissions in a transaction.
   */
  static async updateRole(
    tx: Tx,
    roleId: string,
    data: {
      name?: string;
      permissions?: string[];
    },
  ) {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.permissions !== undefined) updates.permissions = data.permissions;

    const [role] = await tx.update(roles).set(updates).where(eq(roles.id, roleId)).returning();
    return role!;
  }

  /**
   * Delete a role in a transaction.
   */
  static async deleteRole(tx: Tx, roleId: string) {
    await tx.delete(roles).where(eq(roles.id, roleId));
  }

  /**
   * Count how many members are assigned to a specific role.
   */
  static async countMembersHoldingRole(db: DatabaseClient, roleId: string) {
    const result = await db
      .select()
      .from(memberships)
      .where(eq(memberships.roleId, roleId))
      .limit(1);
    return result.length > 0;
  }

  /**
   * Count non-Owner roles in an organization.
   */
  static async countNonOwnerRoles(tx: Tx, orgId: string) {
    const result = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.isOwner, false)));
    return result.length;
  }
}
