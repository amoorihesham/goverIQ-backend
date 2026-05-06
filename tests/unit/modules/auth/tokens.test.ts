import { describe, it, expect } from 'vitest';

import { generateRefreshTokenCleartext, parseUserIdFromCleartext, hashRefreshToken } from '@/modules/auth/tokens';

describe('tokens', () => {
  it('generates cleartext with correct shape', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const cleartext = generateRefreshTokenCleartext(userId);
    const parts = cleartext.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(userId);
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/i);
  });

  it('parses userId from valid cleartext', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const cleartext = generateRefreshTokenCleartext(userId);
    const parsed = parseUserIdFromCleartext(cleartext);
    expect(parsed).toBe(userId);
  });

  it('returns null for malformed cleartext', () => {
    expect(parseUserIdFromCleartext('invalid')).toBeNull();
    expect(parseUserIdFromCleartext('user-id')).toBeNull();
    expect(parseUserIdFromCleartext('550e8400-e29b-41d4-a716-446655440000.short')).toBeNull();
  });

  it('hashes refresh token deterministically', () => {
    const cleartext = '550e8400-e29b-41d4-a716-446655440000.abc123';
    const hash1 = hashRefreshToken(cleartext);
    const hash2 = hashRefreshToken(cleartext);
    expect(hash1).toBe(hash2);
  });

  it('hash produces SHA-256 length', () => {
    const cleartext = '550e8400-e29b-41d4-a716-446655440000.abc123';
    const hash = hashRefreshToken(cleartext);
    expect(hash).toHaveLength(64);
  });
});