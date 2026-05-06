import bcrypt from 'bcryptjs';

import { PASSWORD_COST_FACTOR } from './constants';

const DUMMY_HASH = '$2b$11$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_COST_FACTOR);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function dummyVerifyPassword(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
