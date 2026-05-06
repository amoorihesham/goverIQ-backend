import type { preHandlerHookHandler } from 'fastify';

import { verifyAccessToken } from './jwt';

import { AppError } from '@/shared/errors/http-error';

export const identityRequired: preHandlerHookHandler = async (request) => {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized();
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw AppError.unauthorized();
  }
  const payload = await verifyAccessToken(token);
  request.user = { userId: payload.sub, email: payload.email };
};
