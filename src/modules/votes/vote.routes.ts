import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import { createVoteSchema, castBallotSchema, closeVoteSchema, listVotesSchema, getVoteSchema } from './schemas/zod';
import { createVoteController } from './vote.controller';

import { identityRequired } from '@/shared/auth/identity';
import { db } from '@/shared/database/client';
import { attachOrgId } from '@/shared/http/pre-handlers/attach-org-id';
import { requireOnboardingStep } from '@/shared/http/pre-handlers/on-boarding';
import { requirePermission } from '@/shared/permissions/guard';

export async function voteRoutes(fastify: FastifyInstance) {
  const controller = createVoteController(db);

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/meeting/:meetingId/org/:orgId',
    {
      schema: createVoteSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('vote:create')],
    },
    controller.createVote,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/meeting/:meetingId/org/:orgId',
    {
      schema: listVotesSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('vote:read')],
    },
    controller.listVotes,
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/:voteId/meeting/:meetingId/org/:orgId',
    {
      schema: getVoteSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('vote:read')],
    },
    controller.getVote,
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/:voteId/meeting/:meetingId/org/:orgId/ballots',
    {
      schema: castBallotSchema,
      preHandler: [
        identityRequired,
        attachOrgId,
        requireOnboardingStep('complete'),
        requirePermission('vote:cast_ballot'),
      ],
    },
    controller.castBallot,
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/:voteId/meeting/:meetingId/org/:orgId/close',
    {
      schema: closeVoteSchema,
      preHandler: [identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('vote:close')],
    },
    controller.closeVote,
  );
}
