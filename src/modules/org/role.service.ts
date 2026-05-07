import { eq } from 'drizzle-orm';

import { assertNoPrivilegeEscalation } from './privilege';
import { RoleRepository } from './role.repository';

import { organizations } from '@/db/schema/org';
import { emitAudit } from '@/shared/audit/emitter';
import { db } from '@/shared/database/client';
import { withTx } from '@/shared/database/transaction';
import { AppError } from '@/shared/errors/http-error';

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

export class RoleService {
  /**
   * Get all available permissions.
   */
  static async listPermissions() {
    return ALL_PERMISSIONS;
  }

  /**
   * List all roles for an organization.
   */
  static async listRoles(userId: string, orgId: string) {
    // Verify membership
    const membership = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userId), eq(m.orgId, orgId)),
    });

    if (!membership) {
      throw AppError.forbidden('Not a member of this organization');
    }

    // Get all roles
    const roles = await RoleRepository.listRoles(db, orgId);
    return roles.map((role) => ({
      id: role.id,
      orgId: role.orgId,
      name: role.name,
      isOwner: role.isOwner,
      permissions: role.permissions,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));
  }

  /**
   * Create a new role with privilege escalation check and onboarding advance.
   */
  static async createRole(
    userId: string,
    orgId: string,
    body: { name: string; permissions: string[] },
  ) {
    return await withTx(async (tx) => {
      // Get caller's permissions
      const membership = await tx.query.memberships.findFirst({
        where: (m, { and, eq }) =>
          and(eq(m.userId, userId), eq(m.orgId, orgId)),
        with: { role: true },
      });

      if (!membership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      const callerPermissions = (membership.role as any)?.permissions || [];
      const isOwner = (membership.role as any)?.isOwner ?? false;

      // Check for privilege escalation (unless caller is owner)
      if (!isOwner && callerPermissions.length > 0) {
        assertNoPrivilegeEscalation(callerPermissions, body.permissions);
      }

      // Insert role
      const role = await RoleRepository.insertRole(tx, {
        orgId,
        name: body.name,
        permissions: body.permissions,
      });

      // Check if this is the first non-Owner role (trigger onboarding advance)
      const nonOwnerCount = await RoleRepository.countNonOwnerRoles(tx, orgId);
      if (nonOwnerCount === 1) {
        // Advance onboarding from PENDING_ROLES to PENDING_INVITES
        await tx
          .update(organizations)
          .set({ onboardingStep: 'PENDING_INVITES' })
          .where(eq(organizations.id, orgId));
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
        },
      });

      return {
        id: role.id,
        orgId: role.orgId,
        name: role.name,
        isOwner: role.isOwner,
        permissions: role.permissions,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      };
    });
  }

  /**
   * Get a specific role.
   */
  static async getRole(userId: string, orgId: string, roleId: string) {
    // Verify membership
    const membership = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, userId), eq(m.orgId, orgId)),
    });

    if (!membership) {
      throw AppError.forbidden('Not a member of this organization');
    }

    // Get role
    const role = await RoleRepository.findRoleById(db, orgId, roleId);
    if (!role) {
      throw AppError.notFound('Role not found');
    }

    return {
      id: role.id,
      orgId: role.orgId,
      name: role.name,
      isOwner: role.isOwner,
      permissions: role.permissions,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  /**
   * Update a role (with Owner immutability check and escalation check).
   */
  static async updateRole(
    userId: string,
    orgId: string,
    roleId: string,
    body: { name?: string; permissions?: string[] },
  ) {
    return await withTx(async (tx) => {
      // Verify membership and get permissions
      const membership = await tx.query.memberships.findFirst({
        where: (m, { and, eq }) =>
          and(eq(m.userId, userId), eq(m.orgId, orgId)),
        with: { role: true },
      });

      if (!membership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      const callerPermissions = (membership.role as any)?.permissions || [];
      const isOwner = (membership.role as any)?.isOwner ?? false;

      // Get the role to update
      const role = await RoleRepository.findRoleById(db, orgId, roleId);
      if (!role) {
        throw AppError.notFound('Role not found');
      }

      // Owner role is immutable
      if (role.isOwner) {
        throw AppError.forbidden('Owner role cannot be modified');
      }

      // Check privilege escalation on permission changes
      if (body.permissions && !isOwner && callerPermissions.length > 0) {
        assertNoPrivilegeEscalation(callerPermissions, body.permissions);
      }

      // Update role
      const updated = await RoleRepository.updateRole(tx, roleId, body);

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'role.updated',
        entityType: 'role',
        entityId: roleId,
        payload: {
          name: body.name,
          permissions: body.permissions,
        },
      });

      return {
        id: updated.id,
        orgId: updated.orgId,
        name: updated.name,
        isOwner: updated.isOwner,
        permissions: updated.permissions,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    });
  }

  /**
   * Delete a role (with ROLE_IN_USE check).
   */
  static async deleteRole(userId: string, orgId: string, roleId: string) {
    return await withTx(async (tx) => {
      // Verify membership
      const membership = await tx.query.memberships.findFirst({
        where: (m, { and, eq }) =>
          and(eq(m.userId, userId), eq(m.orgId, orgId)),
      });

      if (!membership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      // Get the role to delete
      const role = await RoleRepository.findRoleById(db, orgId, roleId);
      if (!role) {
        throw AppError.notFound('Role not found');
      }

      // Check if role is in use (has members assigned)
      const hasMembers = await RoleRepository.countMembersHoldingRole(
        db,
        roleId,
      );
      if (hasMembers) {
        throw AppError.roleInUse();
      }

      // Delete role
      await RoleRepository.deleteRole(tx, roleId);

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'role.deleted',
        entityType: 'role',
        entityId: roleId,
        payload: {
          name: role.name,
        },
      });
    });
  }
}
