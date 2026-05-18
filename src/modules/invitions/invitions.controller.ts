import { FastifyReply, FastifyRequest } from 'fastify';

import { createInivitionsService } from './invitions.service';
import { CreateInvitationRequestBody, GetInvitationRequestParams, ListInvitionsRequestParams } from './types/requests';

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
  };
};
