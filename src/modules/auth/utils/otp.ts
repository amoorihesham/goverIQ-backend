import { randomInt, createHash } from 'crypto';

import { CONFIGURATIONS } from '../constants';

export function generateOtp(): string {
  const code = randomInt(0, 10 ** CONFIGURATIONS.OTP_LENGTH);
  return code.toString().padStart(CONFIGURATIONS.OTP_LENGTH, '0');
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
