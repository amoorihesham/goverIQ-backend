import { randomInt, createHash } from 'crypto';

import { OTP_LENGTH } from './constants';

export function generateOtp(): string {
  const code = randomInt(0, 10 ** OTP_LENGTH);
  return code.toString().padStart(OTP_LENGTH, '0');
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
