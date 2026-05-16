import { describe, expect, it } from 'vitest';

import { assertValidTransition, MEETING_TRANSITIONS } from '@/modules/meetings/utils/state-machine';

type Status = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

const ALL_STATUSES: Status[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

describe('MEETING_TRANSITIONS map', () => {
  it('DRAFT allows transition to SCHEDULED only', () => {
    expect(MEETING_TRANSITIONS['DRAFT']).toEqual(['SCHEDULED']);
  });

  it('SCHEDULED allows transition to IN_PROGRESS and CANCELLED', () => {
    expect(MEETING_TRANSITIONS['SCHEDULED']).toEqual(['IN_PROGRESS', 'CANCELLED']);
  });

  it('IN_PROGRESS allows transition to COMPLETED and CANCELLED', () => {
    expect(MEETING_TRANSITIONS['IN_PROGRESS']).toEqual(['COMPLETED', 'CANCELLED']);
  });

  it('COMPLETED is terminal (no allowed transitions)', () => {
    expect(MEETING_TRANSITIONS['COMPLETED']).toEqual([]);
  });

  it('CANCELLED is terminal (no allowed transitions)', () => {
    expect(MEETING_TRANSITIONS['CANCELLED']).toEqual([]);
  });
});

describe('assertValidTransition — allowed transitions (must not throw)', () => {
  const validPairs: [Status, Status][] = [
    ['DRAFT', 'SCHEDULED'],
    ['SCHEDULED', 'IN_PROGRESS'],
    ['SCHEDULED', 'CANCELLED'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['IN_PROGRESS', 'CANCELLED'],
  ];

  for (const [from, to] of validPairs) {
    it(`${from} → ${to} passes`, () => {
      expect(() => assertValidTransition(from, to)).not.toThrow();
    });
  }
});

describe('assertValidTransition — rejected transitions (must throw INVALID_STATE_TRANSITION)', () => {
  const allPairs: [Status, Status][] = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.map((to) => [from, to] as [Status, Status]),
  );
  const validSet = new Set([
    'DRAFT→SCHEDULED',
    'SCHEDULED→IN_PROGRESS',
    'SCHEDULED→CANCELLED',
    'IN_PROGRESS→COMPLETED',
    'IN_PROGRESS→CANCELLED',
  ]);
  const invalidPairs = allPairs.filter(([from, to]) => !validSet.has(`${from}→${to}`));

  for (const [from, to] of invalidPairs) {
    it(`${from} → ${to} throws INVALID_STATE_TRANSITION`, () => {
      expect(() => assertValidTransition(from, to)).toThrow(
        expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
      );
    });
  }
});
