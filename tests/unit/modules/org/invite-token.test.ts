import { createHash } from 'crypto';

import { describe, it, expect } from 'vitest';

import { generateInviteToken, hashInviteToken } from '@/modules/org/invite-token';

describe('invite-token utilities', () => {
  describe('generateInviteToken', () => {
    it('should generate a 64-character lowercase hex string', () => {
      const token = generateInviteToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different tokens on each call', () => {
      const token1 = generateInviteToken();
      const token2 = generateInviteToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashInviteToken', () => {
    it('should deterministically hash a token', () => {
      const token = 'abcdef1234567890';
      const hash1 = hashInviteToken(token);
      const hash2 = hashInviteToken(token);
      expect(hash1).toBe(hash2);
    });

    it('should produce a 64-character lowercase hex string', () => {
      const token = generateInviteToken();
      const hash = hashInviteToken(token);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different inputs', () => {
      const token1 = 'abcdef1234567890';
      const token2 = '0987654321fedcba';
      const hash1 = hashInviteToken(token1);
      const hash2 = hashInviteToken(token2);
      expect(hash1).not.toBe(hash2);
    });

    it('should match SHA-256 hashing', () => {
      const token = 'test-token';
      const expectedHash = createHash('sha256').update(token).digest('hex');
      const actualHash = hashInviteToken(token);
      expect(actualHash).toBe(expectedHash);
    });
  });
});
