import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { verifyAccessToken } from './jwt';

import { AppError } from '@/shared/errors/http-error';

export const identityRequired: preHandlerHookHandler = async (request: FastifyRequest) => {
  const accessToken = request.cookies['access_token'];
  if (!accessToken) throw AppError.unauthorized();

  const payload = await verifyAccessToken(accessToken);
  request.user = { userId: payload.sub, email: payload.email };
};
