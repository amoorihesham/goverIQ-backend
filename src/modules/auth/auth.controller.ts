import { FastifyReply, FastifyRequest } from 'fastify';

import { createAuthService } from './auth.service';
import {
  LoginRequestType,
  RegisterRequestType,
  ResendOtpRequestType,
  VerifyRequestType,
} from './types/request';

import type { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { clearRefreshToken, readRefreshCookie, setRefreshToken } from '@/shared/auth/cookies';

export const createAuthController = (db: DatabaseClient) => {
  const service = createAuthService(db);

  return {
    register: async (
      request: FastifyRequest<{ Body: RegisterRequestType }>,
      reply: FastifyReply,
    ) => {
      await service.register(request.body);
      return reply.status(201).send(success({ message: 'Verification email sent.' }));
    },

    verifyEmail: async (
      request: FastifyRequest<{ Body: VerifyRequestType }>,
      reply: FastifyReply,
    ) => {
      const session = await service.verifyEmail(request.body);
      setRefreshToken(reply, session.refreshTokenCleartext);
      return reply.status(200).send(success({ accessToken: session.accessToken }));
    },

    resendOtp: async (
      request: FastifyRequest<{ Body: ResendOtpRequestType }>,
      reply: FastifyReply,
    ) => {
      await service.resendOtp(request.body);
      return reply.status(200).send(success({ message: 'Verification code resent.' }));
    },

    login: async (request: FastifyRequest<{ Body: LoginRequestType }>, reply: FastifyReply) => {
      const session = await service.login(request.body);
      setRefreshToken(reply, session.refreshTokenCleartext);
      return reply.status(200).send(success({ accessToken: session.accessToken }));
    },

    refresh: async (request: FastifyRequest, reply: FastifyReply) => {
      const cleartext = readRefreshCookie(request);
      const session = await service.refresh(cleartext);
      setRefreshToken(reply, session.refreshTokenCleartext);
      return reply.status(200).send(success({ accessToken: session.accessToken }));
    },

    logout: async (request: FastifyRequest, reply: FastifyReply) => {
      const cleartext = readRefreshCookie(request);
      await service.logout(cleartext);
      clearRefreshToken(reply);
      return reply.status(204).send();
    },
  };
};
