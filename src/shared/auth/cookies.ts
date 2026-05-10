import { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../config/env';

export const setRefreshToken = (reply: FastifyReply, token: string) => {
  reply.setCookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
    signed: true,
  });
};

export const clearRefreshToken = (reply: FastifyReply) => {
  reply.clearCookie(env.REFRESH_COOKIE_NAME);
};

export const readRefreshCookie = (request: FastifyRequest) => {
  const raw = request.cookies[env.REFRESH_COOKIE_NAME];
  if (!raw) return undefined;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : undefined;
};
