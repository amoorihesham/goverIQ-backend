import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { env } from '../config/env';

import { verifyToken } from './jwt';

import { AppError } from '@/shared/errors/http-error';

export const identityRequired: preHandlerHookHandler = async (request: FastifyRequest) => {
  const cookieToken = request.cookies['access_token'];
  const authHeader = request.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const accessToken = cookieToken ?? bearerToken;
  if (!accessToken) throw AppError.create('CONFLICT');

  const payload = await verifyToken(accessToken, env.JWT_ACCESS_SECRET);

  request.user = { userId: payload.userId, email: payload.email };
};

export const tryIdentity: preHandlerHookHandler = async (request: FastifyRequest) => {
  const cookieToken = request.cookies['access_token'];
  const authHeader = request.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const accessToken = cookieToken ?? bearerToken;
  if (!accessToken) return;

  try {
    const payload = await verifyToken(accessToken, env.JWT_ACCESS_SECRET);
    request.user = { userId: payload.userId, email: payload.email };
  } catch {
    // silently ignore missing or invalid token — caller decides if auth is needed
  }
};
