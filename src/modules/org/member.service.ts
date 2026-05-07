import { and, eq } from 'drizzle-orm';

import { CONFIGURATIONS } from './constants';
import { generateInviteToken, hashInviteToken } from './invite-token';
import { MemberRepository } from './member.repository';
import { RoleRepository } from './role.repository';

import { users, refreshTokens } from '@/db/schema/auth';
import { organizations, memberships } from '@/db/schema/org';
import { hashPassword } from '@/modules/auth/password';
import { generateRefreshTokenCleartext, hashRefreshToken } from '@/modules/auth/tokens';
import { emitAudit } from '@/shared/audit/emitter';
import { signAccessToken } from '@/shared/auth/jwt';
import { db } from '@/shared/database/client';
import { withTx } from '@/shared/database/transaction';
import { AppError } from '@/shared/errors/http-error';

export class MemberService {
  /**
   * Send invitation to an email address for a specific role.
   */
  static async sendInvitation(
    userId: string,
    orgId: string,
    body: { email: string; roleId: string },
  ) {
    return await withTx(async (tx) => {
      // Verify caller is a member with invite permission
      const membership = await tx.query.memberships.findFirst({
        where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
        with: { role: true },
      });

      if (!membership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      // Check for pending invite
      const pending = await MemberRepository.findPendingInviteByOrgEmail(db, orgId, body.email);
      if (pending) {
        throw AppError.pendingInviteExists();
      }

      // Verify role exists and belongs to org
      const role = await RoleRepository.findRoleById(db, orgId, body.roleId);
      if (!role) {
        throw AppError.notFound('Role not found');
      }

      // Cannot invite to Owner role
      if (role.isOwner) {
        throw AppError.forbidden('Cannot invite to Owner role');
      }

      // Generate token and hash
      const token = generateInviteToken();
      const tokenHash = hashInviteToken(token);

      // Calculate expiration
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + CONFIGURATIONS.INVITATION_TTL_DAYS);

      // Insert invitation
      const invitation = await MemberRepository.insertInvitation(tx, {
        orgId,
        email: body.email,
        roleId: body.roleId,
        tokenHash,
        expiresAt,
      });

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'member.invited',
        entityType: 'invitation',
        entityId: invitation.id,
        payload: {
          email: body.email,
          roleId: body.roleId,
        },
      });

      // TODO: Send email notification with token link

      return {
        id: invitation.id,
        email: invitation.email,
        roleId: invitation.roleId,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      };
    });
  }

  /**
   * Accept invitation (handles both new and existing users).
   */
  static async acceptInvitation(token: string, body?: { password?: string }) {
    const tokenHash = hashInviteToken(token);

    return await withTx(async (tx) => {
      // Find invitation
      const invitation = await MemberRepository.findInvitationByTokenHash(db, tokenHash);
      if (!invitation) {
        throw AppError.notFound('Invitation not found');
      }

      // Check status
      if (invitation.status !== 'PENDING') {
        throw AppError.conflict('Invitation has already been processed');
      }

      // Check expiration
      if (new Date() > invitation.expiresAt) {
        throw AppError.conflict('Invitation has expired');
      }

      // Check if user exists
      const existingUser = await tx.query.users.findFirst({
        where: eq(users.email, invitation.email),
      });

      let userId: string;
      let accessToken: string | null = null;
      let refreshTokenCleartext: string | null = null;

      if (existingUser) {
        // Existing user: just upsert membership
        userId = existingUser.id;
      } else {
        // New user: create account
        if (!body?.password) {
          throw AppError.validationError('Password is required for new account creation');
        }

        if (body.password.length < 12) {
          throw AppError.validationError('Password must be at least 12 characters');
        }

        const passwordHash = await hashPassword(body.password);
        const [newUser] = await tx
          .insert(users)
          .values({
            email: invitation.email,
            passwordHash,
            isVerified: true, // Invite token proves email ownership
          })
          .returning();

        userId = newUser!.id;

        // Generate refresh token for new user
        refreshTokenCleartext = generateRefreshTokenCleartext(userId);
        const refreshTokenHash = hashRefreshToken(refreshTokenCleartext);

        await tx.insert(refreshTokens).values({
          userId,
          tokenHash: refreshTokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });

        // Issue access token
        accessToken = await signAccessToken({
          sub: userId,
          email: invitation.email,
        });
      }

      // Upsert membership
      const membership = await MemberRepository.upsertMembership(
        tx,
        userId,
        invitation.orgId,
        invitation.roleId,
      );

      // Update invitation status
      await MemberRepository.updateInvitationStatus(tx, invitation.id, 'ACCEPTED');

      // Check if need to advance onboarding
      const org = await tx.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.id, invitation.orgId),
      });

      if (org?.onboardingStep === 'PENDING_INVITES') {
        await tx
          .update(organizations)
          .set({ onboardingStep: 'COMPLETE' })
          .where(eq(organizations.id, invitation.orgId));
      }

      // Emit audit event
      await emitAudit(tx, {
        orgId: invitation.orgId,
        actorId: userId,
        event: 'member.joined',
        entityType: 'membership',
        entityId: membership.id,
        payload: {
          email: invitation.email,
          roleId: invitation.roleId,
        },
      });

      return {
        membership: {
          id: membership.id,
          orgId: membership.orgId,
          roleId: membership.roleId,
          joinedAt: membership.joinedAt,
        },
        accessToken,
        refreshTokenCleartext, // Will be set as cookie by controller
      };
    });
  }

  /**
   * Decline invitation.
   */
  static async declineInvitation(token: string) {
    const tokenHash = hashInviteToken(token);

    return await withTx(async (tx) => {
      // Find invitation
      const invitation = await MemberRepository.findInvitationByTokenHash(db, tokenHash);
      if (!invitation) {
        throw AppError.notFound('Invitation not found');
      }

      // Update status (idempotent - don't error if already declined)
      await MemberRepository.updateInvitationStatus(tx, invitation.id, 'DECLINED');

      // Emit audit event
      await emitAudit(tx, {
        orgId: invitation.orgId,
        event: 'member.declined',
        entityType: 'invitation',
        entityId: invitation.id,
        payload: {
          email: invitation.email,
        },
      });

      return {
        message: 'Invitation declined.',
      };
    });
  }

  /**
   * List members in an organization (paginated).
   */
  static async listMembers(userId: string, orgId: string, cursor?: string, limit: number = 20) {
    // Verify membership
    const membership = await db.query.memberships.findFirst({
      where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
    });

    if (!membership) {
      throw AppError.forbidden('Not a member of this organization');
    }

    const members = await MemberRepository.listMembers(db, orgId, cursor, limit);

    return {
      items: members.slice(0, limit).map((m) => ({
        id: m.id,
        userId: m.userId,
        email: (m.user as any)?.email || '',
        roleId: m.roleId,
        roleName: (m.role as any)?.name || null,
        joinedAt: m.joinedAt,
      })),
      nextCursor: members.length > limit ? members[limit]?.id : null,
    };
  }

  /**
   * Remove a member from organization.
   */
  static async removeMember(userId: string, orgId: string, memberId: string) {
    return await withTx(async (tx) => {
      // Verify caller is a member
      const callerMembership = await tx.query.memberships.findFirst({
        where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
      });

      if (!callerMembership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      // Get target membership
      const targetMembership = await tx.query.memberships.findFirst({
        where: eq(memberships.id, memberId),
        with: { role: true },
      });

      if (!targetMembership) {
        throw AppError.notFound('Membership not found');
      }

      // Sole-owner check: cannot remove if target is sole owner
      if ((targetMembership.role as any)?.isOwner) {
        const ownerCount = await MemberRepository.countOwnersInOrg(db, orgId);
        if (ownerCount === 1) {
          throw AppError.soleOwner();
        }
      }

      // Delete membership
      await MemberRepository.deleteMembership(tx, memberId);

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'member.removed',
        entityType: 'membership',
        entityId: memberId,
        payload: {
          userId: targetMembership.userId,
        },
      });
    });
  }

  /**
   * Assign a role to a member.
   */
  static async assignMemberRole(userId: string, orgId: string, memberId: string, roleId: string) {
    return await withTx(async (tx) => {
      // Verify caller is a member
      const callerMembership = await tx.query.memberships.findFirst({
        where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
      });

      if (!callerMembership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      // Get target membership
      const targetMembership = await tx.query.memberships.findFirst({
        where: eq(memberships.id, memberId),
      });

      if (!targetMembership) {
        throw AppError.notFound('Membership not found');
      }

      // Verify role exists and belongs to org
      const role = await RoleRepository.findRoleById(db, orgId, roleId);
      if (!role) {
        throw AppError.notFound('Role not found');
      }

      // Update membership
      const updated = await MemberRepository.updateMemberRole(tx, memberId, roleId);

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'member.role_assigned',
        entityType: 'membership',
        entityId: memberId,
        payload: {
          userId: targetMembership.userId,
          roleId,
        },
      });

      return {
        id: updated.id,
        userId: updated.userId,
        orgId: updated.orgId,
        roleId: updated.roleId,
      };
    });
  }

  /**
   * Revoke a member's role.
   */
  static async revokeMemberRole(userId: string, orgId: string, memberId: string) {
    return await withTx(async (tx) => {
      // Verify caller is a member
      const callerMembership = await tx.query.memberships.findFirst({
        where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
      });

      if (!callerMembership) {
        throw AppError.forbidden('Not a member of this organization');
      }

      // Get target membership
      const targetMembership = await tx.query.memberships.findFirst({
        where: eq(memberships.id, memberId),
        with: { role: true },
      });

      if (!targetMembership) {
        throw AppError.notFound('Membership not found');
      }

      // Sole-owner check
      if ((targetMembership.role as any)?.isOwner) {
        const ownerCount = await MemberRepository.countOwnersInOrg(db, orgId);
        if (ownerCount === 1) {
          throw AppError.soleOwner();
        }
      }

      // Clear role
      await MemberRepository.clearMemberRole(tx, memberId);

      // Emit audit event
      await emitAudit(tx, {
        orgId,
        actorId: userId,
        event: 'member.role_revoked',
        entityType: 'membership',
        entityId: memberId,
        payload: {
          userId: targetMembership.userId,
        },
      });
    });
  }
}
