import { FastifyReply, FastifyRequest } from 'fastify';

import { createAuthService } from './auth.service';
import {
  LoginRequestType,
  RefreshRequestType,
  RegisterRequestType,
  ResendOtpRequestType,
  VerifyRequestType,
} from './types/request';

import type { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';
import { contextFromRequest } from '@/shared/http/context';
import { NotificationDispatcher } from '@/shared/notifications/dispatcher';
import { clearTokenCookie, setAccessTokenCookie, setRefreshTokenCookie } from '@/shared/auth/cookies';

export const createAuthController = (db: DatabaseClient, dispatcher: NotificationDispatcher) => {
  const service = createAuthService(db, dispatcher);

  return {
    register: async (request: FastifyRequest<{ Body: RegisterRequestType }>, reply: FastifyReply) => {
      const { reqId } = contextFromRequest(request);
      await service.register(request.body, reqId);
      return reply.status(201).send(success({ message: 'Verification email sent.' }));
    },

    verifyEmail: async (request: FastifyRequest<{ Body: VerifyRequestType }>, reply: FastifyReply) => {
      const { reqId } = contextFromRequest(request);
      await service.verifyEmail(request.body, reqId);
      return reply.status(200).send(success({ message: 'Emailverified successfully.' }));
    },

    resendOtp: async (request: FastifyRequest<{ Body: ResendOtpRequestType }>, reply: FastifyReply) => {
      await service.resendOtp(request.body);
      return reply.status(200).send(success({ message: 'Verification code resent.' }));
    },

    login: async (request: FastifyRequest<{ Body: LoginRequestType }>, reply: FastifyReply) => {
      const { reqId } = contextFromRequest(request);
      const session = await service.login(request.body, reqId);
      setRefreshTokenCookie(reply, session.refreshToken);
      setAccessTokenCookie(reply, session.accessToken);
      return reply.status(200).send(success({ ...session.user, accessToken: session.accessToken }));
    },

    refresh: async (request: FastifyRequest<{ Headers: RefreshRequestType }>, reply: FastifyReply) => {
      const refreshToken = request.headers?.cookie?.['refresh_token'];
      const session = await service.refresh(refreshToken);
      setRefreshTokenCookie(reply, session.refreshToken);
      setAccessTokenCookie(reply, session.accessToken);
      return reply.status(200).send(success({ ...session.user, accessToken: session.accessToken }));
    },

    logout: async (request: FastifyRequest<{ Headers: RefreshRequestType }>, reply: FastifyReply) => {
      const { reqId } = contextFromRequest(request);
      const refreshToken = request.headers?.cookie?.['refresh_token'];
      await service.logout(refreshToken, reqId);
      clearTokenCookie(reply, 'access_token');
      clearTokenCookie(reply, 'refresh_token');
      return reply.status(204).send();
    },
  };
};
