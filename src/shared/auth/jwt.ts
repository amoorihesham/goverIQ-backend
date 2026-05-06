import jwt from 'jsonwebtoken';

import { loadEnv } from '@/shared/config/env';
import { AppError } from '@/shared/errors/http-error';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

function getSecret(secret?: string): string {
  if (secret) return secret;
  return loadEnv().JWT_SECRET;
}

export async function signAccessToken(
  payload: AccessTokenPayload,
  secret?: string,
  expiresInSeconds?: number,
): Promise<string> {
  const env = loadEnv();
  return jwt.sign(payload, secret ?? env.JWT_SECRET, {
    expiresIn: expiresInSeconds ?? env.ACCESS_TTL_SECONDS,
  });
}

export async function verifyAccessToken(
  token: string,
  secret?: string,
): Promise<AccessTokenPayload> {
  try {
    const decoded = jwt.verify(token, getSecret(secret));
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
      throw AppError.invalidToken();
    }
    const email = (decoded as jwt.JwtPayload).email;
    if (typeof email !== 'string') {
      throw AppError.invalidToken();
    }
    return { sub: decoded.sub, email };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw AppError.tokenExpired();
    throw AppError.invalidToken();
  }
}
