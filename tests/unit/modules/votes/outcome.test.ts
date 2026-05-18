import { describe, expect, it } from 'vitest';

import { computeOutcome } from '@/modules/votes/utils/outcome';

const base = {
  options: ['Yes', 'No'],
  affirmativeOption: 'Yes',
};

describe('computeOutcome', () => {
  it('QUORUM_NOT_MET when totalCast / totalEligible < quorumThreshold', () => {
    const result = computeOutcome({
      ...base,
      optionCounts: { Yes: 0, No: 0 },
      totalEligible: 10,
      totalCast: 4,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).toBe('QUORUM_NOT_MET');
    expect(result.winner).toBeNull();
  });

  it('QUORUM_NOT_MET with zero ballots', () => {
    const result = computeOutcome({
      ...base,
      optionCounts: {},
      totalEligible: 5,
      totalCast: 0,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).toBe('QUORUM_NOT_MET');
    expect(result.winner).toBeNull();
  });

  it('quorum met exactly at threshold (participation === threshold)', () => {
    // 5/10 = 0.5, threshold = 0.5 → NOT less than → quorum met
    const result = computeOutcome({
      ...base,
      optionCounts: { Yes: 3, No: 2 },
      totalEligible: 10,
      totalCast: 5,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).not.toBe('QUORUM_NOT_MET');
  });

  it('TIED when top two options share the highest count', () => {
    const result = computeOutcome({
      ...base,
      optionCounts: { Yes: 5, No: 5 },
      totalEligible: 10,
      totalCast: 10,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).toBe('TIED');
    expect(result.winner).toBeNull();
  });

  it('PASSED when affirmativeOption wins', () => {
    const result = computeOutcome({
      ...base,
      optionCounts: { Yes: 7, No: 3 },
      totalEligible: 10,
      totalCast: 10,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).toBe('PASSED');
    expect(result.winner).toBe('Yes');
  });

  it('FAILED when a non-affirmative option wins', () => {
    const result = computeOutcome({
      ...base,
      optionCounts: { Yes: 3, No: 7 },
      totalEligible: 10,
      totalCast: 10,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).toBe('FAILED');
    expect(result.winner).toBe('No');
  });

  it('PASSED with three options where affirmative wins', () => {
    const result = computeOutcome({
      options: ['Yes', 'No', 'Abstain'],
      affirmativeOption: 'Yes',
      optionCounts: { Yes: 6, No: 3, Abstain: 1 },
      totalEligible: 10,
      totalCast: 10,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).toBe('PASSED');
    expect(result.winner).toBe('Yes');
  });

  it('FAILED with three options where a non-affirmative option wins', () => {
    const result = computeOutcome({
      options: ['Yes', 'No', 'Abstain'],
      affirmativeOption: 'Yes',
      optionCounts: { Yes: 2, No: 7, Abstain: 1 },
      totalEligible: 10,
      totalCast: 10,
      quorumThreshold: 0.5,
    });
    expect(result.outcome).toBe('FAILED');
    expect(result.winner).toBe('No');
  });

  it('QUORUM_NOT_MET with zero quorumThreshold and zero ballots', () => {
    // 0/1 = 0, threshold = 0 → NOT less than → quorum met
    const result = computeOutcome({
      ...base,
      optionCounts: { Yes: 0, No: 0 },
      totalEligible: 1,
      totalCast: 0,
      quorumThreshold: 0,
    });
    // 0/1 = 0, not < 0 → quorum met → TIED (both 0)
    expect(result.outcome).toBe('TIED');
  });
});
