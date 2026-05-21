import { eq } from 'drizzle-orm';

import { CONFIGURATIONS } from './constants';
import { CreateInvitationRequestBody } from './types/requests';
import { generateInviteToken, hashInviteToken } from './utils/invite-token';

import { invitations, memberships, organizations, refreshTokens, users } from '@/db/schema';
import { emitAudit } from '@/shared/audit/emitter';
import { signToken } from '@/shared/auth/jwt';
import { env } from '@/shared/config/env';
import { withTx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
import { CONFIGURATIONS as AUTH_CONFIGURATIONS } from '@/modules/auth/constants';
import { hashPassword } from '@/modules/auth/utils/password';
import { NotificationDispatcher } from '@/shared/notifications/dispatcher';

export const createInivitionsService = (db: DatabaseClient, dispatcher: NotificationDispatcher) => {
  return {
    listInvitions: async (orgId: string) => {
      return db.query.invitations.findMany({ where: eq(invitations.orgId, orgId) });
    },
    getInvitation: async (invitationId: string, orgId: string) => {
      return db.query.invitations.findFirst({
        where: (invitation, { and, eq }) => and(eq(invitation.orgId, orgId), eq(invitation.id, invitationId)),
      });
    },
    createInvitation: async (userId: string, reqId: string, orgId: string, data: CreateInvitationRequestBody) => {
      const invitationToken = generateInviteToken();
      const invitationTokenHash = hashInviteToken(invitationToken);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + CONFIGURATIONS.INVITATION_TTL_DAYS);

      return withTx(async (tx) => {
        const org = await tx.query.organizations.findFirst({ where: (f, { eq }) => eq(f.id, orgId) });
        if (!org) throw AppError.notFound('Organization not found');

        const [invitation] = await tx
          .insert(invitations)
          .values({
            email: data.email,
            orgId: orgId,
            roleId: data.roleId,
            expiresAt,
            tokenHash: invitationTokenHash,
          })
          .returning();

        emitAudit(tx, {
          orgId: orgId,
          actorId: userId,
          entityType: 'invitation',
          entityId: invitation.id,
          event: 'invitation.created',
          payload: {
            email: data.email,
            reqId,
          },
        });

        const base = env.APP_BASE_URL.replace(/\/$/, '');
        await dispatcher.enqueue('invitation', invitation.email, {
          orgName: org.name,
          expiresAt: invitation.expiresAt,
          acceptUrl: `${base}/invitations/${invitationToken}/accept`,
          declineUrl: `${base}/invitations/${invitationToken}/decline`,
        });

        return invitation;
      });
    },

    acceptInvitation: async (
      callerUserId: string | null,
      callerEmail: string | null,
      reqId: string,
      token: string,
      password?: string,
    ) => {
      const tokenHash = hashInviteToken(token);

      return withTx(async (tx) => {
        const invitation = await tx.query.invitations.findFirst({
          where: eq(invitations.tokenHash, tokenHash),
        });
        if (!invitation) throw AppError.invitationNotFound();

        const now = new Date();

        if (invitation.status === 'ACCEPTED' || invitation.status === 'DECLINED') throw AppError.invitationNotPending();

        if (invitation.status === 'EXPIRED' || invitation.expiresAt <= now) {
          if (invitation.status === 'PENDING') {
            await tx.update(invitations).set({ status: 'EXPIRED' }).where(eq(invitations.id, invitation.id));
          }
          throw AppError.invitationExpired();
        }

        const existingUser = await tx.query.users.findFirst({
          where: eq(users.email, invitation.email),
        });

        let userId: string;
        let userEmail: string;
        let newUserSession: { accessToken: string; refreshToken: string } | null = null;

        if (existingUser) {
          if (!callerUserId) throw AppError.loginRequired();
          if (callerEmail !== invitation.email) throw AppError.emailMismatch();
          userId = existingUser.id;
          userEmail = existingUser.email;
        } else {
          if (!password) throw AppError.passwordRequired();
          const passwordHash = await hashPassword(password);
          const [createdUser] = await tx
            .insert(users)
            .values({ email: invitation.email, passwordHash, isVerified: true })
            .returning();
          userId = createdUser.id;
          userEmail = createdUser.email;

          const refreshToken = await signToken(
            { userId, email: userEmail },
            env.JWT_REFRESH_SECRET,
            AUTH_CONFIGURATIONS.REFRESH_TTL_SECONDS,
          );
          await tx.insert(refreshTokens).values({
            userId,
            tokenHash: refreshToken,
            expiresAt: new Date(Date.now() + AUTH_CONFIGURATIONS.REFRESH_TTL_SECONDS * 1000),
          });
          const accessToken = await signToken(
            { userId, email: userEmail },
            env.JWT_ACCESS_SECRET,
            AUTH_CONFIGURATIONS.ACCESS_TTL_SECONDS,
          );
          newUserSession = { accessToken, refreshToken };
        }

        const [membership] = await tx
          .insert(memberships)
          .values({ userId, orgId: invitation.orgId, roleId: invitation.roleId })
          .onConflictDoUpdate({
            target: [memberships.userId, memberships.orgId],
            set: { roleId: invitation.roleId },
          })
          .returning();

        await tx.update(invitations).set({ status: 'ACCEPTED' }).where(eq(invitations.id, invitation.id));

        const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, invitation.orgId) });
        if (org?.onboardingStep === 'PENDING_INVITES') {
          await tx
            .update(organizations)
            .set({ onboardingStep: 'COMPLETE' })
            .where(eq(organizations.id, invitation.orgId));
        }

        await emitAudit(tx, {
          orgId: invitation.orgId,
          actorId: userId,
          entityType: 'membership',
          entityId: membership.id,
          event: 'member.joined',
          payload: { reqId, invitationId: invitation.id },
        });

        return {
          membership: {
            id: membership.id,
            orgId: membership.orgId,
            roleId: membership.roleId,
            joinedAt: membership.joinedAt,
          },
          accessToken: newUserSession?.accessToken ?? null,
          refreshToken: newUserSession?.refreshToken ?? null,
        };
      });
    },

    declineInvitation: async (reqId: string, token: string) => {
      const tokenHash = hashInviteToken(token);

      return withTx(async (tx) => {
        const invitation = await tx.query.invitations.findFirst({
          where: eq(invitations.tokenHash, tokenHash),
        });
        if (!invitation) throw AppError.invitationNotFound();

        const now = new Date();

        if (invitation.status === 'PENDING' && invitation.expiresAt <= now) {
          await tx.update(invitations).set({ status: 'EXPIRED' }).where(eq(invitations.id, invitation.id));
          throw AppError.invitationExpired();
        }

        if (invitation.status === 'EXPIRED') {
          throw AppError.invitationExpired();
        }

        if (invitation.status === 'DECLINED') {
          return { message: 'Invitation already declined' };
        }

        if (invitation.status === 'ACCEPTED') {
          return { message: 'Invitation was already accepted' };
        }

        await tx.update(invitations).set({ status: 'DECLINED' }).where(eq(invitations.id, invitation.id));

        await emitAudit(tx, {
          orgId: invitation.orgId,
          actorId: null,
          entityType: 'invitation',
          entityId: invitation.id,
          event: 'member.declined',
          payload: { reqId },
        });

        return { message: 'Invitation declined' };
      });
    },
  };
};
