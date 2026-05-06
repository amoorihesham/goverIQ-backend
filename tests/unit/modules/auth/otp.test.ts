import { describe, it, expect } from 'vitest';

import { generateOtp, hashOtp } from '@/modules/auth/otp';

describe('otp', () => {
  it('generates OTP with length 6', () => {
    const otp = generateOtp();
    expect(otp).toHaveLength(6);
  });

  it('generates OTP with all digits', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d+$/);
  });

  it('distribution sanity check across 1000 draws', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const otp = generateOtp();
      counts.set(otp, (counts.get(otp) || 0) + 1);
    }
    const maxCount = Math.max(...counts.values());
    expect(maxCount).toBeLessThan(10);
  });

  it('hashes OTP deterministically', () => {
    const code = '123456';
    const hash1 = hashOtp(code);
    const hash2 = hashOtp(code);
    expect(hash1).toBe(hash2);
  });

  it('hash produces SHA-256 length', () => {
    const code = '123456';
    const hash = hashOtp(code);
    expect(hash).toHaveLength(64);
  });
});