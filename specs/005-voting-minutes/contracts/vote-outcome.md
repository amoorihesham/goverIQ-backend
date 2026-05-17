# Internal Contract: Vote Outcome Computation & Result Summary

**Feature**: 005-voting-minutes
**Consumers**: `vote.service.ts`, `votes/utils/outcome.ts`, the unit test suite

This is an internal contract — it governs module-private code, not an HTTP
surface. It is authored before implementation so the outcome algorithm, the
`result_summary` jsonb shape, and the pure-function signature are fixed and
testable. It implements FR-409.

---

## 1. Pure function (`votes/utils/outcome.ts`)

```ts
export type VoteOutcome = 'QUORUM_NOT_MET' | 'TIED' | 'PASSED' | 'FAILED';

export interface OutcomeInput {
  options: string[]; // the vote's options — ≥ 2 distinct (FR-402)
  optionCounts: Record<string, number>; // ballot count per option (missing ⇒ 0)
  totalEligible: number; // count of vote_eligibility rows — ≥ 1 (FR-403)
  totalCast: number; // count of ballots cast
  quorumThreshold: number; // 0..1 — Number(organizations.quorum_threshold)
  affirmativeOption: string; // votes.affirmative_option — ∈ options
}

export interface OutcomeResult {
  outcome: VoteOutcome;
  winner: string | null; // winning option, or null for TIED / QUORUM_NOT_MET
}

export function computeOutcome(input: OutcomeInput): OutcomeResult;
```

The function is **pure**: no Fastify import, no DB import, no clock, no I/O.
Identical input always yields identical output. It is exhaustively unit-tested
in `tests/unit/modules/votes/outcome.test.ts`.

---

## 2. Algorithm

Given the input above, in order:

1. **Quorum gate.** Compute `participation = totalCast / totalEligible`.
   `totalEligible ≥ 1` is guaranteed by FR-403, so there is no division by zero.
   If `participation < quorumThreshold` → return
   `{ outcome: 'QUORUM_NOT_MET', winner: null }`.

2. **Tally.** For every option in `options`, take its count from `optionCounts`
   (a missing key counts as `0`). Sort the counts descending.

3. **Tie check.** If the two highest counts are equal → return
   `{ outcome: 'TIED', winner: null }`. Because `options` always has ≥ 2 entries
   (FR-402) there are always ≥ 2 counts to compare; if every option has zero
   ballots the two highest are both `0` and the result is `TIED`.

4. **Decided winner.** Exactly one option has the strictly highest count. That
   option is the `winner`.
   - If `winner === affirmativeOption` → `{ outcome: 'PASSED', winner }`.
   - Otherwise → `{ outcome: 'FAILED', winner }`.

### Outcome decision table

| Condition                                              | `outcome`        | `winner`       |
| ------------------------------------------------------ | ---------------- | -------------- |
| `totalCast / totalEligible < quorumThreshold`          | `QUORUM_NOT_MET` | `null`         |
| quorum met AND two highest counts equal                | `TIED`           | `null`         |
| quorum met AND single top option = `affirmativeOption` | `PASSED`         | the top option |
| quorum met AND single top option ≠ `affirmativeOption` | `FAILED`         | the top option |

---

## 3. Edge behavior (locks in spec edge cases)

| Scenario                                           | Result                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| Zero ballots cast, `quorumThreshold > 0`           | `0 / totalEligible = 0 < threshold` → `QUORUM_NOT_MET`            |
| Zero ballots cast, `quorumThreshold = 0`           | `0 ≥ 0` → quorum met; all counts `0` → two highest equal → `TIED` |
| `quorumThreshold = 0`, any participation           | quorum always met; outcome decided by the tally                   |
| Boundary `totalCast / totalEligible === threshold` | `>=` ⇒ quorum **met** (the comparison is "below threshold" only)  |
| All ballots for one non-affirmative option         | quorum permitting → `FAILED`                                      |
| All ballots for the affirmative option             | quorum permitting → `PASSED`                                      |

The comparison is strictly `participation < quorumThreshold` ⇒ not met;
equality meets quorum.

---

## 4. `result_summary` jsonb shape (`votes.result_summary`)

`result_summary` is **null while the vote is `OPEN`**. On close, `vote.service.ts`
builds it from the tally and the `OutcomeResult`, and writes it together with
`outcome`, `status = 'CLOSED'`, and `closed_at` in the same `UPDATE`:

```jsonc
{
  "tally": { "Approve": 7, "Reject": 2, "Abstain": 1 }, // count per option, every option present
  "totalEligible": 12, // count of vote_eligibility rows
  "totalCast": 10, // count of ballots
  "winner": "Approve", // OutcomeResult.winner — null for TIED and QUORUM_NOT_MET
}
```

| Key             | Type                       | Notes                                                                          |
| --------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `tally`         | object<string, integer ≥0> | One entry per option in `votes.options`; options with no ballots appear as `0` |
| `totalEligible` | integer ≥ 1                | Denominator of the quorum ratio                                                |
| `totalCast`     | integer ≥ 0                | Numerator of the quorum ratio; equals the sum of `tally` values                |
| `winner`        | string \| null             | The winning option; `null` for `TIED` and `QUORUM_NOT_MET`                     |

`result_summary` carries **only aggregates** — it never contains a member id or
a member→choice mapping (FR-407, SC-404). It is what the vote list and detail
endpoints expose.

---

## 5. Service responsibilities (not part of the pure function)

`vote.service.ts`, inside the close transaction, must:

1. Tally ballots — `SELECT choice, COUNT(*) FROM ballots WHERE vote_id = ?
GROUP BY choice` — into `optionCounts`.
2. Count `vote_eligibility` rows for `totalEligible` and ballots for `totalCast`.
3. Read `organizations.quorum_threshold` (a `numeric` string) and apply
   `Number()` for `quorumThreshold`.
4. Call `computeOutcome(...)`.
5. Build `result_summary` per §4 and persist `status`, `outcome`,
   `result_summary`, `closed_at` via the guarded `UPDATE … WHERE status='OPEN'`.
6. `emitAudit(tx, { event: 'vote.closed', … })` carrying the outcome — in the
   same transaction.
