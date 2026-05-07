import type { FastifyRequest, FastifyReply } from 'fastify';

import { organizationService } from './org.service';
import {
  CreateOrganizationRequestType,
  OrganizationIdParamRequestType,
  UpdateOrganizationRequestType,
} from './types/request';

import { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';

export const organizationController = (db: DatabaseClient) => {
  const orgService = organizationService(db);
  return {
    create: async (
      request: FastifyRequest<{ Body: CreateOrganizationRequestType }>,
      reply: FastifyReply,
    ) => {
      const org = await orgService.createOrg(request.user!.userId, request.body);
      return reply.code(201).send(success({ data: org }));
    },

    async getOrg(
      request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>,
      reply: FastifyReply,
    ) {
      const org = await orgService.getOrg(request.user!.userId, request.params.orgId);
      return reply.status(200).send(
        success({
          data: org,
        }),
      );
    },
    async getOnboardingStep(
      request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>,
      reply: FastifyReply,
    ) {
      const step = await orgService.getOnboardingStep(request.user!.userId, request.params.orgId);
      return reply.status(200).send(
        success({
          data: step,
        }),
      );
    },

    async skipOnboarding(
      request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>,
      reply: FastifyReply,
    ) {
      const result = await orgService.skipOnboarding(request.user!.userId, request.params.orgId);
      return reply.status(201).send(
        success({
          data: result,
        }),
      );
    },

    async updateOrg(
      request: FastifyRequest<{
        Body: UpdateOrganizationRequestType;
        Params: OrganizationIdParamRequestType;
      }>,
      reply: FastifyReply,
    ) {
      const org = await orgService.updateOrg(
        request.user!.userId,
        request.params.orgId,
        request.body,
      );
      return reply.status(201).send(
        success({
          data: org,
        }),
      );
    },

    async archiveOrg(
      request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>,
      reply: FastifyReply,
    ) {
      await orgService.archiveOrg(request.user!.userId, request.params.orgId);
      return reply.status(200).send();
    },
  };
};
