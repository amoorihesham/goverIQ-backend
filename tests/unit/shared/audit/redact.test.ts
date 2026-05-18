import { describe, expect, it } from 'vitest';

import { AUDIT_REDACTION_DENYLIST, redactAuditPayload } from '@/shared/audit/redact';

describe('AUDIT_REDACTION_DENYLIST', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(AUDIT_REDACTION_DENYLIST)).toBe(true);
  });

  it('contains all expected deny-list keys', () => {
    const expected = [
      'passwordHash',
      'password',
      'otpHash',
      'tokenHash',
      'refreshTokenHash',
      'refreshTokenCleartext',
      'accessToken',
      'inviteTokenHash',
    ];
    expect([...AUDIT_REDACTION_DENYLIST]).toEqual(expect.arrayContaining(expected));
    expect(AUDIT_REDACTION_DENYLIST.length).toBe(expected.length);
  });
});

describe('redactAuditPayload', () => {
  it('removes top-level deny-list keys from an object', () => {
    const input = { passwordHash: 'secret', email: 'user@example.com' };
    const result = redactAuditPayload(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.email).toBe('user@example.com');
  });

  it('removes all deny-list keys', () => {
    const input: Record<string, unknown> = {};
    for (const key of AUDIT_REDACTION_DENYLIST) {
      input[key] = 'value';
    }
    input['safe'] = 'keep';
    const result = redactAuditPayload(input) as Record<string, unknown>;
    for (const key of AUDIT_REDACTION_DENYLIST) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.safe).toBe('keep');
  });

  it('is deep — removes deny-list keys nested inside before/after', () => {
    const input = {
      before: { passwordHash: 'old', name: 'Alice' },
      after: { passwordHash: 'new', name: 'Alice2' },
    };
    const result = redactAuditPayload(input) as any;
    expect(result.before).not.toHaveProperty('passwordHash');
    expect(result.before.name).toBe('Alice');
    expect(result.after).not.toHaveProperty('passwordHash');
    expect(result.after.name).toBe('Alice2');
  });

  it('is deep — removes deny-list keys nested inside data', () => {
    const input = { data: { accessToken: 'tok', userId: '123' } };
    const result = redactAuditPayload(input) as any;
    expect(result.data).not.toHaveProperty('accessToken');
    expect(result.data.userId).toBe('123');
  });

  it('is deep — removes keys at arbitrary nesting depth', () => {
    const input = { level1: { level2: { level3: { password: 'deep' }, safe: true } } };
    const result = redactAuditPayload(input) as any;
    expect(result.level1.level2.level3).not.toHaveProperty('password');
    expect(result.level1.level2.safe).toBe(true);
  });

  it('walks arrays and redacts objects inside them', () => {
    const input = [{ passwordHash: 'a', keep: 1 }, { keep: 2 }];
    const result = redactAuditPayload(input) as any[];
    expect(result[0]).not.toHaveProperty('passwordHash');
    expect(result[0].keep).toBe(1);
    expect(result[1].keep).toBe(2);
  });

  it('is non-mutating — input is unchanged', () => {
    const input = { passwordHash: 'secret', email: 'x@y.com' };
    const copy = JSON.parse(JSON.stringify(input));
    redactAuditPayload(input);
    expect(input).toEqual(copy);
  });

  it('is total — returns primitives unchanged', () => {
    expect(redactAuditPayload('string')).toBe('string');
    expect(redactAuditPayload(42)).toBe(42);
    expect(redactAuditPayload(true)).toBe(true);
  });

  it('is total — returns null unchanged', () => {
    expect(redactAuditPayload(null)).toBeNull();
  });

  it('returns an empty object for an empty object', () => {
    expect(redactAuditPayload({})).toEqual({});
  });

  it('returns an empty array for an empty array', () => {
    expect(redactAuditPayload([])).toEqual([]);
  });
});
