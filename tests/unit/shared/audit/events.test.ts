import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '@/shared/audit/events';

describe('AUDIT_EVENTS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(AUDIT_EVENTS)).toBe(true);
  });

  it('contains exactly 29 distinct entries', () => {
    expect(AUDIT_EVENTS.length).toBe(29);
    const unique = new Set(AUDIT_EVENTS);
    expect(unique.size).toBe(29);
  });

  it('contains all expected event names', () => {
    const expected = [
      'user.registered',
      'user.verified',
      'user.login',
      'user.logout',
      'org.created',
      'org.updated',
      'org.archived',
      'org.onboarding_skipped',
      'role.created',
      'role.updated',
      'role.deleted',
      'member.role_assigned',
      'member.role_revoked',
      'member.removed',
      'invitation.created',
      'meeting.created',
      'meeting.updated',
      'meeting.status_changed',
      'meeting.attendee_added',
      'meeting.attendee_removed',
      'vote.created',
      'vote.closed',
      'ballot.submitted',
      'minutes.created',
      'minutes.updated',
      'minutes.finalized',
      'minutes.correction_added',
      'minutes.exported',
      'system.cleanup',
    ] as const;
    for (const e of expected) {
      expect(AUDIT_EVENTS).toContain(e);
    }
  });
});
