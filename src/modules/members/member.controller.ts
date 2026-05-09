import type { FastifyRequest, FastifyReply } from 'fastify';

import { setRefreshToken } from '@/shared/auth/cookies';
import {
  AsignMemberRoleRequestBody,
  AsignMemberRoleRequestParams,
  InviteMemberRequestBody,
  ListMembersRequest,
  MemberRequestWithOrgIdParam,
  RemoveMembersRequest,
  RevokeMemberRoleRequest,
} from './types/request';
import { DatabaseClient } from '@/shared/database/types';
import { NotificationDispatcher } from '@/shared/notifications/dispatcher';
import { membersService } from './member.service';

interface AcceptInvitationBody {
  password?: string;
}

export const createMemberController = (db: DatabaseClient, dispatcher: NotificationDispatcher) => {
  const service = membersService(db, dispatcher);
  return {
    async sendInvitation(
      request: FastifyRequest<{ Body: InviteMemberRequestBody; Params: MemberRequestWithOrgIdParam }>,
      reply: FastifyReply,
    ) {
      const invitation = await service.sendInvitation(
        request.user!.userId,
        request.params.orgId,
        request.body,
        dispatcher,
      );
      return reply.code(201).send({
        success: true,
        data: invitation,
      });
    },

    async acceptInvitation(request: FastifyRequest, reply: FastifyReply) {
      const token = (request.params as { token: string }).token;
      const body = request.body as AcceptInvitationBody | undefined;
      const result = await service.acceptInvitation(token, body);

      const response = reply.send({
        success: true,
        data: {
          membership: result.membership,
          accessToken: result.accessToken,
        },
      });

      // Set refresh token cookie for new users
      if (result.refreshTokenCleartext) {
        setRefreshToken(reply, result.refreshTokenCleartext);
      }

      return response;
    },

    async declineInvitation(request: FastifyRequest, reply: FastifyReply) {
      const token = (request.params as { token: string }).token;
      const result = await service.declineInvitation(token);
      return reply.send({
        success: true,
        data: result,
      });
    },

    async listMembers(request: FastifyRequest<{ Params: ListMembersRequest }>, reply: FastifyReply) {
      const members = await service.listMembers(request.user!.userId, request.params.orgId);
      return reply.send({
        success: true,
        data: members,
      });
    },

    async removeMember(request: FastifyRequest<{ Params: RemoveMembersRequest }>, reply: FastifyReply) {
      await service.removeMember(request.user!.userId, request.params.orgId, request.params.memberId);
      return reply.code(204).send();
    },

    async assignMemberRole(
      request: FastifyRequest<{ Body: AsignMemberRoleRequestBody; Params: AsignMemberRoleRequestParams }>,
      reply: FastifyReply,
    ) {
      const membership = await service.assignMemberRole(
        request.user!.userId,
        request.params.orgId,
        request.params.memberId,
        request.body.roleId,
      );
      return reply.send({
        success: true,
        data: membership,
      });
    },

    async revokeMemberRole(request: FastifyRequest<{ Params: RevokeMemberRoleRequest }>, reply: FastifyReply) {
      await service.revokeMemberRole(request.user!.userId, request.params.orgId, request.params.memberId);
      return reply.code(204).send();
    },
  };
};
