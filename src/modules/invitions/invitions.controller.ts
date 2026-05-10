import { DatabaseClient } from '@/shared/database/types';
import { NotificationDispatcher } from '@/shared/notifications/dispatcher';
import { createInivitionsService } from './invitions.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { CreateInvitationRequestBody, GetInvitationRequestParams, ListInvitionsRequestParams } from './types/requests';
import { contextFromRequest } from '@/shared/http/context';
import { success } from '@/shared/errors/envelope';

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
      const { userId, reqId } = contextFromRequest(request);
      const invitation = await service.createInvitation(userId!, reqId, request.body);
      return reply.status(201).send(success({ data: invitation }));
    },

    deleteInvitation: async (request: FastifyRequest, reply: FastifyReply) => {},
  };
};
