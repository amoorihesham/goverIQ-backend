import { randomBytes, createHash } from 'crypto';

import { CONFIGURATIONS } from '../constants';

export function generateRefreshTokenCleartext(userId: string): string {
  const random = randomBytes(32).toString('hex');
  return `${userId}.${random}`;
}

export function parseUserIdFromCleartext(cleartext: string): string | null {
  const parts = cleartext.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [userId, hex] = parts;
  if (!userId || !/^[0-9a-f]{64}$/i.test(hex)) {
    return null;
  }
  return userId;
}

export function hashRefreshToken(cleartext: string): string {
  return createHash('sha256').update(cleartext).digest('hex');
}
