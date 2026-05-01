import { jwtVerify } from 'jose';

import { AppError } from '@/shared/errors/http-error';

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}

const secretKey = new TextEncoder().encode(jwtSecret);

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey);

    if (!payload.sub || !payload.email || !payload.iat || !payload.exp) {
      throw new Error('Invalid token claims');
    }

    return {
      sub: payload.sub as string,
      email: payload.email as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('ERR_JWT_EXPIRED')) {
        throw AppError.tokenExpired();
      }
      if (err.message.includes('ERR_JWS_VERIFICATION_FAILED')) {
        throw AppError.invalidToken();
      }
    }
    throw AppError.invalidToken();
  }
}
