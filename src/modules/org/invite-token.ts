import { randomBytes, createHash } from 'crypto';
import { INVITATION_TOKEN_BYTES } from './constants';

export function generateInviteToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}