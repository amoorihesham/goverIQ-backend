import type { FastifyRequest, FastifyReply } from 'fastify';

import { meetingService } from './meeting.service';
import {
  CreateMeetingBody,
  TransitionStatusBody,
  AddAttendeesBody,
  ListMeetingsQuery,
  UpdateMeetingBody,
} from './types/request';

import { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { contextFromRequest } from '@/shared/http/context';

export const createMeetingController = (db: DatabaseClient) => {
  const service = meetingService(db);

  return {
    async createMeeting(
      request: FastifyRequest<{ Params: { orgId: string }; Body: CreateMeetingBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const meeting = await service.createMeeting(userId!, orgId!, request.body);
      return reply.code(201).send(success(meeting));
    },

    async transitionStatus(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: TransitionStatusBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const meeting = await service.transitionStatus(userId!, orgId!, request.params.meetingId, request.body);
      return reply.send(success(meeting));
    },

    async addAttendees(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: AddAttendeesBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const inserted = await service.addAttendees(userId!, orgId!, request.params.meetingId, request.body);
      return reply.code(201).send(success(inserted));
    },

    async removeAttendee(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string; memberId: string } }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      await service.removeAttendee(userId!, orgId!, request.params.meetingId, request.params.memberId);
      return reply.code(204).send();
    },

    async listMeetings(
      request: FastifyRequest<{ Params: { orgId: string }; Querystring: ListMeetingsQuery }>,
      reply: FastifyReply,
    ) {
      const { orgId } = contextFromRequest(request);
      const page = await service.listMeetings(orgId!, request.query);
      return reply.send(success(page));
    },

    async getMeeting(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string } }>,
      reply: FastifyReply,
    ) {
      const { orgId } = contextFromRequest(request);
      const meeting = await service.getMeeting(request.params.meetingId, orgId!);
      return reply.send(success(meeting));
    },

    async updateMeeting(
      request: FastifyRequest<{ Params: { meetingId: string; orgId: string }; Body: UpdateMeetingBody }>,
      reply: FastifyReply,
    ) {
      const { userId, orgId } = contextFromRequest(request);
      const meeting = await service.updateMeeting(userId!, orgId!, request.params.meetingId, request.body);
      return reply.send(success(meeting));
    },
  };
};
