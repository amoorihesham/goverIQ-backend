# Research: Voting & Minutes

**Feature**: 005-voting-minutes | **Date**: 2026-05-17
**Input**: [plan.md](./plan.md), [spec.md](./spec.md)

Thirteen decisions resolve every unknown in the plan's Technical Context. Each
records what was chosen, why, and the alternatives rejected.

---

## Decision 1 — Two separate modules (`votes`, `minutes`)

**Decision**: Deliver Phase 4 as two independent domain modules,
`src/modules/votes/` and `src/modules/minutes/`, each registered at its own
route prefix (`/votes`, `/minutes`).

**Rationale**: Votes and minutes are distinct aggregates with separate
lifecycles, permission domains, and audit events. Keeping them apart mirrors how
Phase 2 split into `org` / `roles` / `members` / `invitions`, keeps each module
small and single-purpose (Constitution I), and lets their integration test
suites run independently. The single coupling point — a resolution referencing a
closed vote — is a foreign-key lookup, not a code dependency.

**Alternatives considered**: One combined `governance` module — rejected: it
would bundle unrelated lifecycles behind one barrel export and inflate the
service file past the single-responsibility line.

---

## Decision 2 — Store the affirmative option as a `votes` column

**Decision**: Add a `NOT NULL` `affirmative_option` text column to the `votes`
table via an additive Drizzle migration. The vote-creation request carries an
explicit `affirmativeOption` field, validated to be one of `options`.

**Rationale**: The clarification (spec FR-402) requires every vote to designate
a passing option, but the Phase 0 schema predates that requirement and has no
place for it. An explicit, queryable column is the cleanest data model: the
outcome computation reads it directly, and the value is auditable. The migration
is purely additive (one `ADD COLUMN`) and runs against an **empty** `votes`
table — Phase 4 has not shipped — so `NOT NULL` with no default is safe and
non-destructive. This does not constitute the "schema churn" the Phase 0
upfront-schema principle guards against; it is a one-time additive change for a
requirement clarified after Phase 0.

**Alternatives considered**:
- *Positional convention (`options[0]` is the affirmative option)* — no schema
  change, but encodes semantics in array order; implicit and error-prone for API
  consumers and future readers.
- *Explicit field + server reorder* — accept `affirmativeOption`, then reorder
  `options` so it sits first; rejected because silently rearranging
  client-supplied input is surprising and still relies on positional meaning.

This was confirmed with the user during planning ("Add a votes column").

---

## Decision 3 — Flat route shape, consistent with the meetings module

**Decision**: Use the flat route shape the implemented `meetings` module
established — org and meeting identifiers are path segments, not a nested
hierarchy:
`/votes/meeting/:meetingId/org/:orgId`,
`/minutes/meeting/:meetingId/org/:orgId/...`.

**Rationale**: The implementation-plan prose shows `/orgs/:orgId/meetings/...`
nesting, but the *implemented* meetings module uses the flat
`/:meetingId/org/:orgId` form so the `attachOrgId` pre-handler can lift `:orgId`
into context for `requirePermission`. Consistency with the live codebase beats
consistency with stale prose. Both `:meetingId` and `:orgId` appear in the path
so the service can scope every query to the org and meeting.

**Alternatives considered**: Org-nested routes per the plan prose — rejected for
inconsistency with the four shipped modules and the `attachOrgId` contract.

---

## Decision 4 — Outcome computation as a pure, exhaustively tested util

**Decision**: Implement the quorum + outcome logic as a pure function
`computeOutcome(input): OutcomeResult` in `votes/utils/outcome.ts`, importing
nothing from Fastify or the database.

**Rationale**: This is the algorithmic heart of the module (FR-409) and the
highest-risk logic — quorum boundary, ties, passed/failed, zero ballots. A pure
function is exhaustively unit-testable in milliseconds with no DB fixture
(Constitution II), exactly as `meetings` did with `state-machine.ts`. The
service supplies tallies and the threshold; the util decides.

**Alternatives considered**: Computing inline in the service — rejected: it
would force every branch to be exercised through DB-backed integration tests,
slower and harder to cover to 100%.

---

## Decision 5 — Quorum threshold parsing

**Decision**: Read `organizations.quorum_threshold` (a `numeric(3,2)`, returned
by the `pg` driver as a string such as `"0.50"`) and convert with `Number()`
before passing it to `computeOutcome`. The comparison is
`totalCast / totalEligible >= threshold`.

**Rationale**: Drizzle surfaces `numeric` columns as strings to preserve
precision; the quorum ratio is a plain floating-point comparison, so an explicit
numeric conversion at the service boundary keeps the pure util working in
`number` space. A threshold of `0` is valid and means any participation clears
quorum.

**Alternatives considered**: Decimal-library arithmetic — rejected as
unnecessary precision for a single ratio comparison; no new dependency needed.

---

## Decision 6 — Ballot choice validated at runtime against `vote.options`

**Decision**: The Zod body schema validates that `choice` is a non-empty
string; the service then checks `vote.options.includes(choice)` at runtime and
throws `VALIDATION_ERROR` (HTTP 400) if not.

**Rationale**: The set of valid choices is per-vote data, unknown at schema
compile time, so Zod alone cannot enforce it. The runtime check inside the
ballot transaction is the only correct place. FR-405 mandates the rejection.

**Alternatives considered**: A dynamic per-request Zod enum built from the
loaded vote — rejected: it would require fetching the vote before validation
runs, inverting the pre-handler/handler order for no benefit over a one-line
service check.

---

## Decision 7 — Duplicate ballot via unique-constraint translation

**Decision**: Rely on the existing `ballots_vote_voter_unique` index. The
service inserts the ballot and translates a unique-violation error into
`AppError.duplicateBallot()` (HTTP 409).

**Rationale**: The database constraint is the authoritative one-ballot-per-
member guarantee and is race-free under concurrency (FR-406, the concurrent
edge case). A pre-check `SELECT` would still leave a race window; catching the
constraint violation does not. The shared DB-error helper already classifies
unique violations.

**Alternatives considered**: `SELECT`-then-`INSERT` — rejected for the
time-of-check/time-of-use race.

---

## Decision 8 — Eligibility snapshot is strictly insert-only

**Decision**: `vote_eligibility` rows are inserted once, inside the
`createVote` transaction, and never updated or deleted by any code path in this
feature. No service method, route, or util writes to the table after creation.

**Rationale**: FR-403 and SC-402 require the snapshot to be immutable —
later attendee changes must not affect a vote's eligible set. Enforcing this by
*absence of write paths* is simpler and stronger than any runtime guard.
`vote_eligibility` has no `id` and no update timestamp, which already signals an
insert-only table.

**Alternatives considered**: Recomputing eligibility from attendees at ballot
time — rejected: it would make eligibility mutable, directly violating FR-403.

---

## Decision 9 — Minutes export as PDF via `pdfkit`

**Decision**: The export endpoint produces a PDF document, rendered by the
`pdfkit` library (a new runtime dependency), streamed back with
`Content-Type: application/pdf` and a `Content-Disposition: attachment` header.
Rendering is isolated in `minutes/utils/pdf.ts`.

**Rationale**: FR-420 calls for a "structured, human-readable document suitable
for compliance archiving" — PDF is the archival standard. `pdfkit` is MIT-
licensed, widely used, and actively maintained, satisfying the Constitution's
dependency-evaluation rule. Phase 5's audit export also requires PDF, so the
dependency is introduced once and reused. Confirmed with the user during
planning ("PDF").

**Alternatives considered**:
- *HTML / Markdown* — no new dependency, but shifts the burden of producing an
  archival artifact onto the client.
- *Headless-browser PDF (Puppeteer)* — rejected: a heavyweight dependency and a
  bundled browser binary, far more than this export needs.

---

## Decision 10 — Minutes read is identity-only via a new `requireMembership` pre-handler

**Decision**: The minutes-read route uses a new shared pre-handler,
`src/shared/http/pre-handlers/require-membership.ts`, which resolves the
caller's org membership and sets `request.orgMembership` but enforces no
permission key. All other routes keep `requirePermission(<key>)`.

**Rationale**: The clarification settled that any org member may read minutes
(no `minutes:read` needed), while export still requires `minutes:read`.
`requirePermission` always demands a key, so a thin membership-only pre-handler
is required to still reject non-members with `FORBIDDEN`. It reuses the exact
membership query from `guard.ts`.

**Alternatives considered**:
- *Checking membership inside the service* — rejected: membership resolution is
  a cross-cutting concern handled by pre-handlers everywhere else in the
  codebase; the service should receive an already-authorized caller.
- *Refactoring `requirePermission` to compose `requireMembership`* — deferred:
  desirable cleanup but out of scope; keeping `requirePermission` untouched
  minimizes regression risk to four shipped modules.

---

## Decision 11 — Two new error codes; reuse the rest

**Decision**: Add `VOTE_CLOSED` (422) and `MINUTES_FINALIZED` (422) to the
error registry, each with an `AppError` factory. Reuse `DUPLICATE_BALLOT` (409),
`MEETING_HAS_OPEN_VOTES` (409), `INVALID_STATE_TRANSITION` (422), `CONFLICT`
(409), `FORBIDDEN`, `NOT_FOUND`, and `VALIDATION_ERROR` as-is.

**Rationale**: The implementation plan's error table lists `VOTE_CLOSED` and
`MINUTES_FINALIZED` at 422; both are genuine state-machine violations and have
no existing equivalent. Every other failure mode in this feature maps onto a
code already in the registry. `QUORUM_NOT_MET` exists in the registry but is
**not** used as an error here — quorum failure is a recorded vote outcome, never
a rejected request.

**Alternatives considered**: Reusing `INVALID_STATE_TRANSITION` for closed-vote
and finalized-minutes cases — rejected: distinct machine-readable codes give API
clients precise, actionable failures (Constitution III).

---

## Decision 12 — Concurrency-safe vote close

**Decision**: `closeVote` performs the status change as a guarded update —
`UPDATE votes SET status='CLOSED', … WHERE id=? AND status='OPEN'` — and treats
a zero-row result as `CONFLICT` (vote already closed).

**Rationale**: Two callers may close the same vote concurrently (spec edge
case). The guarded `WHERE status='OPEN'` makes exactly one update win; the loser
sees zero rows affected and is rejected. This is the same pattern
`meeting.service.ts` uses for status transitions.

**Alternatives considered**: A separate `SELECT … FOR UPDATE` lock — rejected:
the guarded update achieves the same atomicity in one statement.

---

## Decision 13 — Resolutions emit no audit event

**Decision**: Attaching a resolution to draft minutes inserts a
`minutes_resolutions` row but emits **no** audit event. The eight audit events
are exactly `vote.created`, `ballot.submitted`, `vote.closed`,
`minutes.created`, `minutes.updated`, `minutes.finalized`,
`minutes.correction_added`, `minutes.exported`.

**Rationale**: The implementation plan's Phase 4 audit table defines exactly
these eight events and lists no resolution event. A resolution is a sub-edit of
a draft minutes document; the `minutes.updated` event already covers draft
mutation if the team later wants resolution changes audited. Adding an unlisted
ninth event would diverge from the master plan and the Phase 5 audit-integrity
checklist.

**Alternatives considered**: Emitting a `minutes.resolution_added` event —
rejected: not in the sanctioned 27-event Phase 5 set; would fail the audit
integrity verification.

---

## Resolved Unknowns Summary

| Technical Context item            | Resolution |
| ---------------------------------- | ---------- |
| New dependency?                    | `pdfkit` + `@types/pdfkit` (Decision 9) |
| Schema change?                     | One additive migration — `votes.affirmative_option` (Decision 2) |
| Route shape                        | Flat, meeting-and-org path segments (Decision 3) |
| Outcome algorithm placement        | Pure `votes/utils/outcome.ts` (Decision 4) |
| Quorum threshold type handling     | `Number()` on the `numeric` string (Decision 5) |
| New error codes                    | `VOTE_CLOSED`, `MINUTES_FINALIZED` (Decision 11) |
| Identity-only minutes read         | New `requireMembership` pre-handler (Decision 10) |

No `NEEDS CLARIFICATION` markers remain. Ready for Phase 1 design artifacts.
