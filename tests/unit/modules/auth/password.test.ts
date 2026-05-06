import { describe, it, expect } from 'vitest';

import { hashPassword, verifyPassword } from '@/modules/auth/password';

describe('password', () => {
  it('hashes same password differently (salt presence)', async () => {
    const password = 'correct-horse-battery';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });

  it('verifies correct password returns true', async () => {
    const password = 'correct-horse-battery';
    const hash = await hashPassword(password);
    const result = await verifyPassword(password, hash);
    expect(result).toBe(true);
  });

  it('verifies wrong password returns false', async () => {
    const password = 'correct-horse-battery';
    const hash = await hashPassword(password);
    const result = await verifyPassword('wrong-password', hash);
    expect(result).toBe(false);
  });

  it('encodes cost factor in hash header', async () => {
    const password = 'test-password';
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^\$2[aby]\$/);
  });
});