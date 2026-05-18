import jwt from 'jsonwebtoken';

import { AppError } from '@/shared/errors/http-error';

export interface TokenPayload {
  userId: string;
  email: string;
}

export async function signToken(payload: TokenPayload, secret: string, expiresInSeconds: number): Promise<string> {
  return jwt.sign(payload, secret, {
    expiresIn: expiresInSeconds,
  });
}

export async function verifyToken(token: string, secret: string): Promise<TokenPayload> {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string' || !('userId' in decoded) || !('email' in decoded))
    throw AppError.create('INVALID_TOKEN');

  return { userId: decoded.userId!, email: decoded.email! };
}
