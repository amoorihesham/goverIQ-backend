import type { FastifyRequest, FastifyReply } from 'fastify';

import { CreateVoteBody, CastBallotBody, ListVotesQuery } from './types/request';
import { voteService } from './vote.service';

import { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { contextFromRequest } from '@/shared/http/context';

export const createVoteController = (db: DatabaseClient) => {
  const service = voteService(db);

  return {
    async createVote(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: CreateVoteBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const vote = await service.createVote(userId!, orgId!, request.params.meetingId, request.body);
      return reply.code(201).send(success(vote));
    },

    async castBallot(
      request: FastifyRequest<{
        Params: { voteId: string; meetingId: string; orgId: string };
        Body: CastBallotBody;
      }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      await service.castBallot(userId!, orgId!, request.params.meetingId, request.params.voteId, request.body);
      return reply.code(204).send();
    },

    async closeVote(
      request: FastifyRequest<{ Params: { voteId: string; meetingId: string; orgId: string } }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const vote = await service.closeVote(userId!, orgId!, request.params.meetingId, request.params.voteId);
      return reply.send(success(vote));
    },

    async listVotes(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Querystring: ListVotesQuery }>,
      reply: FastifyReply,
    ) {
      const { orgId } = contextFromRequest(request);
      const page = await service.listVotes(orgId!, request.params.meetingId, request.query);
      return reply.send(success(page));
    },

    async getVote(
      request: FastifyRequest<{ Params: { voteId: string; meetingId: string; orgId: string } }>,
      reply: FastifyReply,
    ) {
      const { orgId } = contextFromRequest(request);
      const vote = await service.getVote(orgId!, request.params.meetingId, request.params.voteId);
      return reply.send(success(vote));
    },
  };
};
