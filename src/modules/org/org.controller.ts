import type { FastifyRequest, FastifyReply } from 'fastify';

import { organizationService } from './org.service';
import {
  CreateOrganizationRequestType,
  OrganizationIdParamRequestType,
  UpdateOrganizationRequestType,
} from './types/request';

import { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { contextFromRequest } from '@/shared/http/context';

export const organizationController = (db: DatabaseClient) => {
  const orgService = organizationService(db);
  return {
    async getOrg(request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const org = await orgService.getOrg(userId!, orgId!);
      return reply.status(200).send(
        success({
          message: 'Organization retrived successfully.',
          data: org,
        }),
      );
    },
    create: async (request: FastifyRequest<{ Body: CreateOrganizationRequestType }>, reply: FastifyReply) => {
      const { userId, reqId } = contextFromRequest(request);
      const org = await orgService.createOrg(userId!, reqId, request.body);
      return reply.code(201).send(success({ data: org, message: 'Organization created successfully.' }));
    },

    async getOnboardingStep(request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>, reply: FastifyReply) {
      const { orgId, userId } = contextFromRequest(request);
      const step = await orgService.getOnboardingStep(userId!, orgId!);
      return reply.status(200).send(
        success({
          data: step,
        }),
      );
    },

    async skipOnboarding(request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>, reply: FastifyReply) {
      const { orgId, userId, reqId } = contextFromRequest(request);
      const result = await orgService.skipOnboarding(userId!, orgId!, reqId!);
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
      const { orgId, userId, reqId } = contextFromRequest(request);
      const org = await orgService.updateOrg(userId!, orgId!, reqId!, request.body);
      return reply.status(201).send(
        success({
          message: 'Organization updated successfully.',
          data: org,
        }),
      );
    },

    async archiveOrg(request: FastifyRequest<{ Params: OrganizationIdParamRequestType }>, reply: FastifyReply) {
      const { orgId, reqId, userId } = contextFromRequest(request);
      await orgService.archiveOrg(userId!, orgId!, reqId);
      return reply.status(200).send({ message: 'Organization deleted successfully.' });
    },
  };
};
