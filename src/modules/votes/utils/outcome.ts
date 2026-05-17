export type VoteOutcome = 'QUORUM_NOT_MET' | 'TIED' | 'PASSED' | 'FAILED';

interface OutcomeInput {
  options: string[];
  optionCounts: Record<string, number>;
  totalEligible: number;
  totalCast: number;
  quorumThreshold: number;
  affirmativeOption: string;
}

export function computeOutcome(input: OutcomeInput): { outcome: VoteOutcome; winner: string | null } {
  const { options, optionCounts, totalEligible, totalCast, quorumThreshold, affirmativeOption } = input;

  if (totalCast / totalEligible < quorumThreshold) {
    return { outcome: 'QUORUM_NOT_MET', winner: null };
  }

  const counts = options.map((o) => optionCounts[o] ?? 0).sort((a, b) => b - a);
  if (counts[0] === counts[1]) return { outcome: 'TIED', winner: null };

  const winner = options.find((o) => (optionCounts[o] ?? 0) === counts[0])!;
  return { outcome: winner === affirmativeOption ? 'PASSED' : 'FAILED', winner };
}
