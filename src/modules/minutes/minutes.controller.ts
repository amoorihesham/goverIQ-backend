import type { FastifyRequest, FastifyReply } from 'fastify';

import { minutesService } from './minutes.service';
import { CreateMinutesBody, EditMinutesBody, AttachResolutionBody, AppendCorrectionBody } from './types/request';

import { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { contextFromRequest } from '@/shared/http/context';

export const createMinutesController = (db: DatabaseClient) => {
  const service = minutesService(db);

  return {
    async createMinutes(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: CreateMinutesBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const doc = await service.createMinutes(userId!, orgId!, request.params.meetingId, request.body);
      return reply.code(201).send(success(doc));
    },

    async editMinutes(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: EditMinutesBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const doc = await service.editMinutes(userId!, orgId!, request.params.meetingId, request.body);
      return reply.send(success(doc));
    },

    async attachResolution(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: AttachResolutionBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const resolution = await service.attachResolution(userId!, orgId!, request.params.meetingId, request.body);
      return reply.code(201).send(success(resolution));
    },

    async finalizeMinutes(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string } }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const doc = await service.finalizeMinutes(userId!, orgId!, request.params.meetingId);
      return reply.send(success(doc));
    },

    async appendCorrection(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: AppendCorrectionBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const correction = await service.appendCorrection(userId!, orgId!, request.params.meetingId, request.body);
      return reply.code(201).send(success(correction));
    },

    async readMinutes(request: FastifyRequest<{ Params: { meetingId: string; orgId: string } }>, reply: FastifyReply) {
      const { orgId } = contextFromRequest(request);
      const doc = await service.readMinutes(orgId!, request.params.meetingId);
      return reply.send(success(doc));
    },

    async exportMinutes(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string } }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const pdfBuffer = await service.exportMinutes(userId!, orgId!, request.params.meetingId);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="minutes-${request.params.meetingId}.pdf"`)
        .send(pdfBuffer);
    },
  };
};
