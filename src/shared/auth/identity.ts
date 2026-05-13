import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { AppError } from '@/shared/errors/http-error';
import { verifyToken } from './jwt';
import { env } from '../config/env';

export const identityRequired: preHandlerHookHandler = async (request: FastifyRequest) => {
  const accessToken = request.cookies['access_token'];
  if (!accessToken) throw AppError.create('UNAUTHORIZED');

  const payload = await verifyToken(accessToken, env.JWT_ACCESS_SECRET);

  request.user = { userId: payload.userId, email: payload.email };
};
