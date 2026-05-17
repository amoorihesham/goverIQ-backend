# Implementation Plan: Voting & Minutes

**Branch**: `005-voting-minutes` | **Date**: 2026-05-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/005-voting-minutes/spec.md`

## Summary

Build Phase 4 as two new domain modules — `src/modules/votes/` (5 endpoints) and
`src/modules/minutes/` (7 endpoints) — following the flat-route, factory-function
conventions of the implemented `meetings` module. Votes open formal decisions
inside `IN_PROGRESS` meetings, freeze an immutable eligibility snapshot, accept
one confidential ballot per eligible member, and close with a quorum/outcome
computation. Minutes capture the official record of a `COMPLETED` meeting,
moving `DRAFT → FINALIZED` (immutable), with append-only corrections,
vote-backed resolutions, and a PDF export.

One **additive, non-destructive schema change**: a `votes.affirmative_option`
column (the vote's designated passing choice — resolved in clarification). One
new runtime dependency: `pdfkit`, for the minutes PDF export. Two new error
codes (`VOTE_CLOSED`, `MINUTES_FINALIZED`) and one new shared pre-handler
(`requireMembership`, for the identity-only minutes-read route). Eight audit
events emit transactionally. The `IN_PROGRESS → COMPLETED` open-votes guard is
**already wired and active** in `meeting.service.ts` — this feature only makes
it exercisable with real vote data. The module set satisfies all 24 functional
requirements (FR-401 … FR-424) and all 10 success criteria (SC-401 … SC-410).

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js 24 LTS (unchanged)
**Primary Dependencies**: Fastify 5.8.x, Drizzle ORM 0.45.x, Zod 4.x, Pino,
`fastify-type-provider-zod` — all installed. **One new runtime dependency:
`pdfkit`** (+ `@types/pdfkit` dev) for the minutes export (FR-420).
**Storage**: existing `votes` / `vote_eligibility` / `ballots` / `minutes` /
`minutes_resolutions` / `minutes_corrections` Postgres tables from Phase 0. One
**additive migration** adds a non-null `votes.affirmative_option` text column —
safe because `votes` is empty until this feature ships. Reads `meetings`,
`meeting_attendees`, `memberships`, and `organizations.quorum_threshold`.
**Testing**: Vitest (unit + integration). Integration helpers at
`tests/integration/helpers/db.ts` gain a `truncateVotingMinutesTables()`
addition.
**Target Platform**: Linux server / Node.js 24 (containerized, stateless).
**Project Type**: Backend web service — modular monolith. `votes` and `minutes`
are the 6th and 7th domain modules.
**Performance Goals**: All endpoints p95 < 200 ms (Constitution IV). Hot paths —
vote list (keyset query on `votes_meeting_status_idx`), ballot insert (single
insert + unique-index check), close (bounded `GROUP BY` tally + two `COUNT`s +
one update), minutes read (one row + two indexed child fetches) — are all
fixed-shape and index-backed against 1,000 meetings with associated votes/
minutes (SC-410).
**Constraints**: Every state-changing handler MUST run inside `withTx` so
`emitAudit(tx, …)` joins the same transaction (FR-423 + Constitution audit
invariant). The vote eligibility snapshot is insert-only — no code path updates
or deletes `vote_eligibility` (FR-403). Per-member ballot choices are never
serialized into any response (FR-407). Permission resolution is per-request from
the DB — no caching. All routes are reachable only when org onboarding is
`COMPLETE` (FR-422).
**Scale/Scope**: 12 protected routes across 2 modules, 1 pure outcome util, 1
PDF-rendering util, 1 new shared pre-handler, 2 new error codes, 8 audit events,
1 additive migration, ≈ 18 new source files plus tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Status | Gate Verification |
| ---------------------------- | ------ | ----------------- |
| I. Code Quality              | Pass   | Each module split into routes / controller / service / schemas / types / constants; the outcome computation is a pure `utils/outcome.ts` with no Fastify or DB import; PDF rendering isolated in `utils/pdf.ts`; quorum/page-size constants are named; lint + Prettier enforced |
| II. Testing Standards        | Pass   | Exhaustive unit tests for `outcome.ts` (quorum-not-met, tie, passed, failed, zero ballots); 8 integration test files, one per user story slice plus the meeting-completion guard; rollback-injection confirms transactional audit; coverage stays ≥ 80%; TDD enforced |
| III. API Design Consistency  | Pass   | All 12 responses use the existing success/error envelope; all errors use registry codes (2 new codes added here); 2 OpenAPI contracts + 1 internal contract authored before any handler; cursor pagination consistent with Phase 0 conventions |
| IV. Performance Requirements | Pass   | Vote list uses keyset pagination on `votes_meeting_status_idx`; ballot insert relies on `ballots_vote_voter_unique`; close tally is a single `GROUP BY`; eligibility/correction fetches hit existing indexes — no N+1 patterns |

**Pre-design Constitution Check: PASS.** The one schema change and the one new
dependency are evaluated in `research.md` (Decisions 2 and 9) and are
non-violating: an additive column on an empty table is non-destructive, and
`pdfkit` is MIT-licensed and actively maintained. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/005-voting-minutes/
├── plan.md              # This file
├── research.md          # Phase 0 output — 13 technical decisions
├── data-model.md        # Phase 1 output — column-level mapping, 1 migration, state transitions, audit writes
├── quickstart.md        # Phase 1 output — end-to-end verification walkthrough
├── contracts/
│   ├── votes.openapi.yaml      # 5 vote endpoints
│   ├── minutes.openapi.yaml    # 7 minutes endpoints
│   └── vote-outcome.md         # Internal contract: quorum + outcome computation, result-summary shape
└── tasks.md             # Phase 2 output (NOT created here — /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── modules/
│   ├── votes/                            # NEW — 6th domain module
│   │   ├── public.ts                     # exports voteRoutes
│   │   ├── vote.routes.ts                # 5 endpoints + pre-handler wiring
│   │   ├── vote.controller.ts            # createVoteController(db) factory
│   │   ├── vote.service.ts               # voteService(db) — withTx + emitAudit + guards
│   │   ├── schemas/
│   │   │   └── zod.ts                    # request/response Zod schemas (≥2 distinct options, affirmativeOption ∈ options)
│   │   ├── types/
│   │   │   └── request.ts                # typed params/bodies
│   │   ├── constants/
│   │   │   └── index.ts                  # VOTES_PAGE_SIZE_DEFAULT/MAX, MIN_VOTE_OPTIONS
│   │   └── utils/
│   │       └── outcome.ts                # computeOutcome(...) — pure quorum + outcome function
│   └── minutes/                          # NEW — 7th domain module
│       ├── public.ts                     # exports minutesRoutes
│       ├── minutes.routes.ts             # 7 endpoints + pre-handler wiring
│       ├── minutes.controller.ts         # createMinutesController(db) factory
│       ├── minutes.service.ts            # minutesService(db) — withTx + emitAudit + guards
│       ├── schemas/
│       │   └── zod.ts                    # request/response Zod schemas
│       ├── types/
│       │   └── request.ts                # typed params/bodies
│       └── utils/
│           └── pdf.ts                    # renderMinutesPdf(...) — assembles the export document
├── db/
│   └── schema/
│       └── vote.ts                       # ADD affirmativeOption column
├── shared/
│   ├── errors/
│   │   ├── codes.ts                      # ADD VOTE_CLOSED, MINUTES_FINALIZED
│   │   └── http-error.ts                 # ADD voteClosed(), minutesFinalized() factories
│   └── http/
│       └── pre-handlers/
│           └── require-membership.ts     # NEW — resolves org membership without a permission key
├── app.ts                                # REGISTER voteRoutes (/votes) + minutesRoutes (/minutes) + 2 swagger tags
└── (drizzle migration)                   # NEW additive migration — votes.affirmative_option

tests/
├── unit/
│   └── modules/votes/
│       └── outcome.test.ts               # every quorum/outcome branch + zero-ballot + boundary
└── integration/
    ├── helpers/
    │   └── db.ts                         # ADD truncateVotingMinutesTables()
    ├── modules/votes/
    │   ├── vote-create.test.ts           # US1 — FR-401..404, FR-411 (eligibility snapshot immutability)
    │   ├── vote-ballot.test.ts           # US2 — FR-405..407
    │   └── vote-close.test.ts            # US3 — FR-408, FR-409
    └── modules/minutes/
        ├── meeting-completion-guard.test.ts  # US3 — FR-410 (open-votes guard now exercisable)
        ├── minutes-create-edit.test.ts   # US4 — FR-412..415
        ├── minutes-finalize.test.ts      # US5 — FR-416, FR-417
        ├── minutes-corrections.test.ts   # US6 — FR-418
        └── minutes-view-export.test.ts   # US7 — FR-419, FR-420
```

**Structure Decision**: Single-project modular monolith — unchanged since
Phase 0. `votes` and `minutes` mirror the layout of `meetings` (controller /
service / routes / schemas / types / constants). `votes` adds a pure
`utils/outcome.ts` so the quorum + outcome logic is unit-tested without a DB;
`minutes` adds `utils/pdf.ts` to isolate the one new dependency. Neither module
needs a state-machine util — votes (`OPEN → CLOSED`) and minutes
(`DRAFT → FINALIZED`) each have a single transition, guarded inline in the
service. The new shared `requireMembership` pre-handler gates the one route
(minutes read) that requires org membership but no specific permission key.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. This section is intentionally empty.

---

## Implementation Notes

### Schema Change — `votes.affirmative_option` (data-model.md)

```ts
// src/db/schema/vote.ts — added to the votes table
affirmativeOption: text('affirmative_option').notNull(),
```

The column is `NOT NULL` with no default — safe because `votes` holds zero rows
until this feature ships. Generated via `drizzle-kit generate`; the migration is
purely additive (one `ADD COLUMN`). Rationale and the rejected alternatives
(positional convention, explicit-field-plus-reorder) are recorded in
`research.md` Decision 2.

### New Error Codes (codes.ts additions)

```ts
VOTE_CLOSED:       { code: 'VOTE_CLOSED',       httpStatus: 422,
  message: 'Vote is closed' },
MINUTES_FINALIZED: { code: 'MINUTES_FINALIZED', httpStatus: 422,
  message: 'Minutes are finalized and cannot be modified' },
```

Plus `AppError.voteClosed()` and `AppError.minutesFinalized()` factory methods.
`DUPLICATE_BALLOT` (409), `MEETING_HAS_OPEN_VOTES` (409),
`INVALID_STATE_TRANSITION` (422), `CONFLICT` (409), `FORBIDDEN`, `NOT_FOUND`,
and `VALIDATION_ERROR` already exist and are reused as-is. The registry's
`QUORUM_NOT_MET` entry is **not** used as an error — quorum failure is a
recorded vote *outcome*, never a rejected request; closing always succeeds.

### Outcome Computation (votes/utils/outcome.ts — pure)

```ts
export interface OutcomeInput {
  ballots: { choice: string }[];
  options: string[];
  affirmativeOption: string;
  totalEligible: number;       // ≥ 1, guaranteed by FR-403
  quorumThreshold: number;     // parsed from organizations.quorum_threshold
}
export interface OutcomeResult {
  outcome: 'PASSED' | 'FAILED' | 'TIED' | 'QUORUM_NOT_MET';
  resultSummary: {
    counts: Record<string, number>;   // every option, including zero-count
    totalEligible: number;
    totalCast: number;
    winningOption: string | null;     // null when QUORUM_NOT_MET or TIED
  };
}
```

Algorithm: tally `counts` per option; `totalCast = ballots.length`. If
`totalCast / totalEligible < quorumThreshold` → `QUORUM_NOT_MET`. Otherwise sort
counts descending; if the top two are equal → `TIED`; else the single top option
is the winner → `PASSED` when `winner === affirmativeOption`, else `FAILED`. See
`contracts/vote-outcome.md` for the full contract and worked examples.

### Vote Service Guards (vote.service.ts, inside withTx)

```ts
// createVote — meeting must be live
if (meeting.status !== 'IN_PROGRESS') throw AppError.invalidStateTransition(...);
// eligibility snapshot: null → all current attendees; else validate ⊆ attendees, non-empty

// castBallot
if (vote.status !== 'OPEN') throw AppError.voteClosed();
// resolve caller membershipId from (userId, orgId); must be in vote_eligibility else FORBIDDEN
if (!vote.options.includes(body.choice)) throw AppError.validationError('Choice not in options');
// insert ballot; unique violation on ballots_vote_voter_unique → AppError.duplicateBallot()

// closeVote — concurrency-safe
const [updated] = await tx.update(votes)
  .set({ status: 'CLOSED', outcome, resultSummary, closedAt: new Date() })
  .where(and(eq(votes.id, voteId), eq(votes.status, 'OPEN')))
  .returning();
if (!updated) throw AppError.conflict('Vote already closed');
```

### Minutes Service Guards (minutes.service.ts, inside withTx)

```ts
// createMinutes — meeting must be COMPLETED; unique minutes_meeting_id_unique → CONFLICT
if (meeting.status !== 'COMPLETED') throw AppError.invalidStateTransition(...);
// updateMinutes / attachResolution — must be DRAFT
if (minutes.status !== 'DRAFT') throw AppError.minutesFinalized();
// attachResolution — referenced vote must belong to this meeting AND be CLOSED
// appendCorrection — must be FINALIZED
if (minutes.status !== 'FINALIZED')
  throw AppError.invalidStateTransition('Corrections apply only to finalized minutes');
```

### FR-410 — Open-Votes Guard Already Active

The `IN_PROGRESS → COMPLETED` guard is **already implemented** in
`meeting.service.ts` (`transitionStatus`, the `meeting.status === 'IN_PROGRESS'
&& body.status === 'COMPLETED'` branch) — it counts `votes` with
`status = 'OPEN'` and throws `AppError.meetingHasOpenVotes()`. **No code change
is required.** This feature only makes the guard exercisable, because real votes
can now exist. `meeting-completion-guard.test.ts` verifies it end-to-end.

### Minutes Read — Identity-Only Access

Per the clarification, reading minutes requires only org membership, no
permission key. A new shared pre-handler resolves membership and sets
`request.orgMembership`, throwing `FORBIDDEN` for non-members:

```ts
// src/shared/http/pre-handlers/require-membership.ts
export const requireMembership: preHandlerHookHandler = async (request) => {
  const { userId, orgId } = contextFromRequest(request);
  if (!userId || !orgId) throw AppError.create('UNAUTHORIZED');
  const [membership] = await db.select({ /* roleId, isOwner, permissions */ })
    .from(memberships).leftJoin(roles, eq(memberships.roleId, roles.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId))).limit(1);
  if (!membership) throw AppError.create('FORBIDDEN', 'Not a member of the organization');
  request.orgMembership = { /* … */ };
};
```

All other routes keep `requirePermission(<key>)`.

### Route Wiring (flat shape, consistent with the meetings module)

```text
voteRoutes      prefix /api/v1/votes
  POST   /meeting/:meetingId/org/:orgId               vote:create
  GET    /meeting/:meetingId/org/:orgId               vote:read
  GET    /:voteId/meeting/:meetingId/org/:orgId        vote:read
  POST   /:voteId/meeting/:meetingId/org/:orgId/ballots vote:cast_ballot
  PATCH  /:voteId/meeting/:meetingId/org/:orgId/close   vote:close

minutesRoutes   prefix /api/v1/minutes
  POST   /meeting/:meetingId/org/:orgId               minutes:create
  GET    /meeting/:meetingId/org/:orgId               requireMembership (identity only)
  PATCH  /meeting/:meetingId/org/:orgId               minutes:update
  POST   /meeting/:meetingId/org/:orgId/resolutions    minutes:update
  POST   /meeting/:meetingId/org/:orgId/finalize       minutes:finalize
  POST   /meeting/:meetingId/org/:orgId/corrections    minutes:update
  GET    /meeting/:meetingId/org/:orgId/export         minutes:read
```

Every route's pre-handler chain is
`identityRequired → attachOrgId → requireOnboardingStep('complete') → <permission|membership>`.

### app.ts Registration

```ts
const tagBySegment = { /* …existing… */ votes: 'Votes', minutes: 'Minutes' };
// …in the /api/v1 scope:
await instance.register(voteRoutes,    { prefix: '/votes' });
await instance.register(minutesRoutes, { prefix: '/minutes' });
// …add { name: 'Votes', … } and { name: 'Minutes', … } to the swagger tags array.
```

### Test Helper Addition

```ts
// tests/integration/helpers/db.ts
export async function truncateVotingMinutesTables(): Promise<void> {
  const db = getDatabaseClient();
  await db.execute(sql`TRUNCATE votes, vote_eligibility, ballots,
    minutes, minutes_resolutions, minutes_corrections RESTART IDENTITY CASCADE`);
}
```

---

## Post-Design Constitution Re-check

After generating `research.md`, `data-model.md`, `contracts/`, and
`quickstart.md`:

| Principle                    | Status | Notes |
| ---------------------------- | ------ | ----- |
| I. Code Quality              | Pass   | `outcome.ts` is pure (no Fastify/DB import); single responsibility per file; the PDF dependency is isolated in `minutes/utils/pdf.ts`; quorum/page-size values are named constants |
| II. Testing Standards        | Pass   | 1 unit file exhaustively covers the outcome matrix; 8 integration files cover every FR/SC; rollback-injection tests confirm transactional audit for all 8 events |
| III. API Design Consistency  | Pass   | 2 OpenAPI contracts + 1 internal contract authored before implementation; all routes use the existing envelope; 2 new error codes registered; cursor pagination unchanged |
| IV. Performance Requirements | Pass   | Vote list keyset query, ballot unique-index insert, close `GROUP BY` tally, and indexed minutes child fetches are all bounded fixed-cost — no N+1; PDF render is CPU-bound and off the DB hot path |

**Post-design Constitution Check: PASS.** Ready for `/speckit-tasks`.
