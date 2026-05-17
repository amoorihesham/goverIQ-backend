import type { FastifyRequest, FastifyReply } from 'fastify';

import { membersService } from './member.service';
import {
  AsignMemberRoleRequestBody,
  AsignMemberRoleRequestParams,
  GetMemberDetailsRequestParams,
  GetMembersInOrganizationRequestParams,
  RemoveMemberRequestParams,
  RevokeMemberRoleRequestParams,
} from './types/request';

import { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { contextFromRequest } from '@/shared/http/context';

export const createMemberController = (db: DatabaseClient) => {
  const service = membersService(db);
  return {
    async getMembersInOrganization(
      request: FastifyRequest<{ Params: GetMembersInOrganizationRequestParams }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const result = await service.getMembersInOrganization(userId!, orgId!);
      return reply.status(200).send(success({ message: 'Members fetched successfully.', data: result }));
    },

    async getMemberDetails(request: FastifyRequest<{ Params: GetMemberDetailsRequestParams }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const result = await service.getMemberDetails(userId!, orgId!, request.params.memberId);
      return reply.status(200).send(success({ message: 'Member fetched successfully.', data: result }));
    },

    async assignMemberRole(
      request: FastifyRequest<{ Body: AsignMemberRoleRequestBody; Params: AsignMemberRoleRequestParams }>,
      reply: FastifyReply,
    ) {
      const { orgId, userId, reqId } = contextFromRequest(request);
      const membership = await service.assignMemberRole(
        userId!,
        orgId!,
        request.params.memberId,
        request.body.roleId,
        reqId,
      );
      return reply.status(204).send(
        success({
          message: 'Role assined successfully.',
          data: membership,
        }),
      );
    },

    async removeMember(request: FastifyRequest<{ Params: RemoveMemberRequestParams }>, reply: FastifyReply) {
      const { orgId, userId, reqId } = contextFromRequest(request);
      await service.removeMember(userId!, orgId!, request.params.memberId, reqId);
      return reply.code(204).send(success({ message: 'Member deleted successfully.' }));
    },

    async revokeMemberRole(request: FastifyRequest<{ Params: RevokeMemberRoleRequestParams }>, reply: FastifyReply) {
      const { orgId, userId, reqId } = contextFromRequest(request);
      await service.revokeMemberRole(userId!, orgId!, request.params.memberId, reqId);
      return reply.code(204).send(success({ message: 'Member role revoked.' }));
    },
  };
};
