import { FastifyReply } from 'fastify';

import { env } from '../config/env';

export const setTokenCookie = (reply: FastifyReply, cookieName: string, token: string) => {
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
  });
};

export const clearTokenCookie = (reply: FastifyReply, cookieName: string) => {
  reply.clearCookie(cookieName);
};
