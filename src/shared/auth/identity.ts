import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { AppError } from '@/shared/errors/http-error';
import { verifyToken } from './jwt';
import { env } from '../config/env';

export const identityRequired: preHandlerHookHandler = async (request: FastifyRequest) => {
  const cookieToken = request.cookies['access_token'];
  const authHeader = request.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const accessToken = cookieToken ?? bearerToken;
  if (!accessToken) throw AppError.create('UNAUTHORIZED');

  const payload = await verifyToken(accessToken, env.JWT_ACCESS_SECRET);

  request.user = { userId: payload.userId, email: payload.email };
};
