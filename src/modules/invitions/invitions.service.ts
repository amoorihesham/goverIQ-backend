import { eq } from 'drizzle-orm';

import { CONFIGURATIONS } from './constants';
import { CreateInvitationRequestBody } from './types/requests';
import { generateInviteToken, hashInviteToken } from './utils/invite-token';

import { invitations } from '@/db/schema';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
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
        const org = await db.query.organizations.findFirst({ where: eq(invitations.orgId, orgId) });
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

        await dispatcher.enqueue('invitation', invitation.email, {
          orgName: org.name,
          expiresAt: invitation.expiresAt.getDate(),
          acceptUrl: '',
          declineUrl: '',
        });

        return invitation;
      });
    },
  };
};
