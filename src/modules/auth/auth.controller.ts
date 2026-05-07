import { FastifyReply, FastifyRequest } from 'fastify';

import { createAuthService } from './auth.service';
import {
  LoginRequestType,
  RegisterRequestType,
  ResendOtpRequestType,
  VerifyRequestType,
} from './types/request';

import { env } from '@/shared/config/env';
import type { DatabaseClient } from '@/shared/database/types';
import { success } from '@/shared/errors/envelope';

export const createAuthController = (db: DatabaseClient) => {
  const service = createAuthService(db);

  function refreshCookieAttrs() {
    return {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      signed: true,
      maxAge: env.REFRESH_TTL_SECONDS,
    };
  }

  function readRefreshCookie(request: FastifyRequest): string | undefined {
    const raw = request.cookies[env.REFRESH_COOKIE_NAME];
    if (!raw) return undefined;
    const unsigned = request.unsignCookie(raw);
    return unsigned.valid && unsigned.value ? unsigned.value : undefined;
  }

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
      reply.setCookie(env.REFRESH_COOKIE_NAME, session.refreshTokenCleartext, refreshCookieAttrs());
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
      reply.setCookie(env.REFRESH_COOKIE_NAME, session.refreshTokenCleartext, refreshCookieAttrs());
      return reply.status(200).send(success({ accessToken: session.accessToken }));
    },

    refresh: async (request: FastifyRequest, reply: FastifyReply) => {
      const cleartext = readRefreshCookie(request);
      const session = await service.refresh(cleartext);
      reply.setCookie(env.REFRESH_COOKIE_NAME, session.refreshTokenCleartext, refreshCookieAttrs());
      return reply.status(200).send(success({ accessToken: session.accessToken }));
    },

    logout: async (request: FastifyRequest, reply: FastifyReply) => {
      const cleartext = readRefreshCookie(request);
      await service.logout(cleartext);
      reply.clearCookie(env.REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });
      return reply.status(204).send();
    },
  };
};
