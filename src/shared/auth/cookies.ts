import { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../config/env';

export const setRefreshTokenCookie = (reply: FastifyReply, token: string) => {
  reply.setCookie(env.REFRESH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    signed: true,
  });
};

export const setAccessTokenCookie = (reply: FastifyReply, token: string) => {
  reply.setCookie(env.ACCESS_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    signed: true,
  });
};

export const clearTokenCookie = (reply: FastifyReply, cookieName: string) => {
  reply.clearCookie(cookieName);
};
