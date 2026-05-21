import { FastifyReply, FastifyRequest } from 'fastify';

import { createInivitionsService } from './invitions.service';
import { CreateInvitationRequestBody, GetInvitationRequestParams, ListInvitionsRequestParams } from './types/requests';

import { CONFIGURATIONS as AUTH_CONFIGURATIONS } from '@/modules/auth/constants';
import { setTokenCookie } from '@/shared/auth/cookies';
import { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { contextFromRequest } from '@/shared/http/context';
import { NotificationDispatcher } from '@/shared/notifications/dispatcher';

export const invitionsController = (db: DatabaseClient, dispatcher: NotificationDispatcher) => {
  const service = createInivitionsService(db, dispatcher);
  return {
    listInvitions: async (request: FastifyRequest<{ Params: ListInvitionsRequestParams }>, reply: FastifyReply) => {
      const { orgId } = contextFromRequest(request);
      const invitions = await service.listInvitions(orgId!);
      return reply.status(200).send(success({ data: invitions }));
    },
    getInvitation: async (request: FastifyRequest<{ Params: GetInvitationRequestParams }>, reply: FastifyReply) => {
      const { orgId } = contextFromRequest(request);
      const invitation = await service.getInvitation(request.params.invitationId, orgId!);
      return reply.status(200).send(success({ data: invitation ?? null }));
    },

    createInvitation: async (request: FastifyRequest<{ Body: CreateInvitationRequestBody }>, reply: FastifyReply) => {
      const { userId, reqId, orgId } = contextFromRequest(request);
      const invitation = await service.createInvitation(userId!, reqId, orgId!, request.body);
      return reply.status(201).send(success({ data: invitation }));
    },

    deleteInvitation: async (request: FastifyRequest, reply: FastifyReply) => {
      const { reqId } = contextFromRequest(request);
      reply.status(200).send(success({ reqId }));
    },

    acceptInvitation: async (
      request: FastifyRequest<{ Params: { token: string }; Body: { password?: string } }>,
      reply: FastifyReply,
    ) => {
      const { reqId } = contextFromRequest(request);
      const callerUserId = request.user?.userId ?? null;
      const callerEmail = request.user?.email ?? null;

      const result = await service.acceptInvitation(
        callerUserId,
        callerEmail,
        reqId,
        request.params.token,
        request.body.password,
      );

      if (result.refreshToken) {
        setTokenCookie(reply, AUTH_CONFIGURATIONS.REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, '/api/v1/auth');
        setTokenCookie(reply, AUTH_CONFIGURATIONS.ACCESS_TOKEN_COOKIE_NAME, result.accessToken!, '/api/v1');
      }

      return reply.status(200).send(success({ membership: result.membership, accessToken: result.accessToken }));
    },

    declineInvitation: async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      const { reqId } = contextFromRequest(request);
      const result = await service.declineInvitation(reqId, request.params.token);
      return reply.status(200).send(success({ message: result.message }));
    },
  };
};
