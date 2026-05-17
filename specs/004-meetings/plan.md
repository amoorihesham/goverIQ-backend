# Implementation Plan: Meetings Module

**Branch**: `004-meetings` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-meetings/spec.md`

## Summary

Build the Meetings module — the 5th domain module — as `src/modules/meetings/`,
following the flat-route, factory-function conventions of `org` / `roles` /
`members` / `invitions`. Seven Fastify route handlers cover the meeting
lifecycle: create (with agenda), list, detail, edit, status transition, and
attendee add/remove. A pure, unit-testable state machine (`utils/state-machine.ts`)
validates every status transition; DB-dependent guards (attendee count, the
15-minute open window, open votes) run in the service inside `withTx`. Two new
error codes (`INVALID_STATE_TRANSITION`, `MEETING_TOO_EARLY`) join the shared
registry; `MEETING_HAS_OPEN_VOTES` already exists. Five audit events emit
transactionally. **No schema changes** — `meetings`, `meeting_agenda_items`, and
`meeting_attendees` already exist from Phase 0. The module satisfies all 17
functional requirements (FR-301 … FR-317) and all 7 success criteria
(SC-301 … SC-307).

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js 24 LTS (unchanged)
**Primary Dependencies**: Fastify 5.8.x, Drizzle ORM, Zod 4.x, Pino,
`fastify-type-provider-zod` — all installed. No new runtime dependencies.
**Storage**: existing `meetings` / `meeting_agenda_items` / `meeting_attendees`
Postgres tables — no migrations. The `votes` table (also from Phase 0) is read
by the open-votes guard.
**Testing**: Vitest (unit + integration). Integration helpers at
`tests/integration/helpers/` need a `truncateMeetingTables()` addition.
**Target Platform**: Linux server / Node.js 24 (containerized, stateless).
**Project Type**: Backend web service — modular monolith. `src/modules/meetings/`
is the 5th domain module.
**Performance Goals**: All endpoints p95 < 200 ms (Constitution IV). The hot
paths — list (keyset query on `meetings_org_status_idx`), status transition
(meeting fetch + bounded guard queries + update + audit insert), attendee add
(bulk insert with conflict-skip) — are all fixed-shape and index-backed against
1,000 meetings (SC-307).
**Constraints**: Every state-changing handler MUST run inside `withTx` so
`emitAudit(tx, …)` joins the same transaction (FR-315 + Constitution audit
invariant). Status transitions MUST be validated against the transition map
before any guard runs (FR-304). Permission resolution MUST be per-request from
the DB — no caching. Meeting routes are reachable only when org onboarding is
`COMPLETE` (FR-314).
**Scale/Scope**: 7 protected routes, 1 pure state-machine util, 1 module-local
pre-handler, 2 new error codes, 5 audit events, ≈ 11 new source files plus
tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Status | Gate Verification                                                                                                                                                                                                                    |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Code Quality              | Pass   | Module split into routes / controller / service / schemas / types; the state machine is a pure module with no Fastify or DB import; magic numbers (15-min window, page sizes) become named constants; lint + Prettier enforced       |
| II. Testing Standards        | Pass   | Unit tests for `state-machine.ts` (every transition + rejection); 5 integration test files, one per user story (create, status, attendees, list, update); coverage stays ≥ 80%; TDD enforced                                         |
| III. API Design Consistency  | Pass   | All 7 responses use the existing success/error envelope; all errors use registry codes (2 new codes added here); `meetings.openapi.yaml` contract authored before any handler; cursor pagination consistent with Phase 0 conventions |
| IV. Performance Requirements | Pass   | List uses keyset pagination on `meetings_org_status_idx`; the open-votes guard hits `votes_meeting_status_idx`; attendee add is a single bulk insert; agenda replace is one delete + one insert — no N+1 patterns                    |

**Pre-design Constitution Check: PASS.** No violations. Complexity Tracking
section is empty.

## Project Structure

### Documentation (this feature)

```text
specs/004-meetings/
├── plan.md              # This file
├── research.md          # Phase 0 output — 11 technical decisions
├── data-model.md        # Phase 1 output — column-level mapping, state transitions, audit writes
├── quickstart.md        # Phase 1 output — end-to-end verification walkthrough
├── contracts/
│   ├── meetings.openapi.yaml      # 7 meeting endpoints
│   └── meeting-state-machine.md   # Internal contract: transition map, guards, status pre-handler
└── tasks.md             # Phase 2 output (NOT created here — /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── modules/
│   └── meetings/                         # NEW — 5th domain module
│       ├── public.ts                     # exports meetingRoutes
│       ├── meeting.routes.ts             # 7 endpoints + pre-handler wiring
│       ├── meeting.controller.ts         # createMeetingController(db) factory
│       ├── meeting.service.ts            # meetingService(db) — withTx + emitAudit + guards
│       ├── schemas/
│       │   └── zod.ts                    # request/response Zod schemas (scheduledAt future refine)
│       ├── types/
│       │   └── request.ts                # typed params/bodies
│       ├── constants/
│       │   └── index.ts                  # MEETING_EARLY_OPEN_MINUTES, page-size defaults
│       ├── utils/
│       │   └── state-machine.ts          # MEETING_TRANSITIONS + assertValidTransition (pure)
│       └── pre-handlers/
│           └── status-permission.ts      # requireStatusTransitionPermission
├── shared/
│   └── errors/
│       ├── codes.ts                      # ADD INVALID_STATE_TRANSITION, MEETING_TOO_EARLY
│       └── http-error.ts                 # ADD 2 AppError factory methods
└── app.ts                                # REGISTER meetingRoutes (prefix /meetings) + Meetings tag

tests/
├── unit/
│   └── modules/meetings/
│       └── state-machine.test.ts         # every valid transition + every rejection
└── integration/
    ├── helpers/
    │   └── db.ts                         # ADD truncateMeetingTables()
    └── modules/meetings/
        ├── meeting-create.test.ts        # US1 — FR-301..303, FR-317
        ├── meeting-status.test.ts        # US2 — FR-304..307
        ├── meeting-attendees.test.ts     # US3 — FR-308, FR-309
        ├── meeting-list.test.ts          # US4 — FR-311, FR-312
        └── meeting-update.test.ts        # US5 — FR-310, FR-317
```

**Structure Decision**: Single-project modular monolith — unchanged since
Phase 0. The new `meetings` module mirrors the layout of `roles` and `members`
(controller / service / routes / schemas / types / constants), with two
additions: a pure `utils/state-machine.ts` so transition logic is unit-tested
without a DB, and a module-local `pre-handlers/status-permission.ts` because the
status endpoint needs a dynamic permission key.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. This section is intentionally empty.

---

## Implementation Notes

### New Error Codes (codes.ts additions)

```ts
INVALID_STATE_TRANSITION: { code: 'INVALID_STATE_TRANSITION', httpStatus: 422,
  message: 'Invalid state transition' },
MEETING_TOO_EARLY: { code: 'MEETING_TOO_EARLY', httpStatus: 422,
  message: 'Meeting cannot be opened more than 15 minutes early' },
```

`MEETING_HAS_OPEN_VOTES` already exists in the registry (httpStatus 409) and is
reused as-is.

### State Machine (utils/state-machine.ts — pure)

```ts
export const MEETING_TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  DRAFT: ['SCHEDULED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertValidTransition(from: MeetingStatus, to: MeetingStatus): void {
  if (!MEETING_TRANSITIONS[from].includes(to)) {
    throw AppError.invalidStateTransition(`Cannot transition meeting from ${from} to ${to}`);
  }
}
```

### Status-Transition Permission Pre-handler

```ts
// src/modules/meetings/pre-handlers/status-permission.ts
export const requireStatusTransitionPermission: preHandlerHookHandler = async (req, reply) => {
  const target = (req.body as { status?: string })?.status;
  const key = target === 'CANCELLED' ? 'meeting:cancel' : 'meeting:update';
  return requirePermission(key)(req, reply);
};
```

Body is available at the `preHandler` stage (validation runs first), so the
target status can be read to choose the key. Owner bypass is inherited from
`requirePermission`.

### Transition Guards (meeting.service.ts, inside withTx)

```ts
// SCHEDULED → IN_PROGRESS
if (attendeeCount < 1) throw AppError.invalidStateTransition('Meeting has no attendees');
const earliest = new Date(meeting.scheduledAt.getTime() - MEETING_EARLY_OPEN_MINUTES * 60_000);
if (Date.now() < earliest.getTime()) throw AppError.meetingTooEarly();

// IN_PROGRESS → COMPLETED  (FR-306 — wired now, real effect in Phase 4)
const [openVotes] = await tx
  .select({ n: count() })
  .from(votes)
  .where(and(eq(votes.meetingId, meeting.id), eq(votes.status, 'OPEN')));
if (openVotes.n > 0) throw AppError.create('MEETING_HAS_OPEN_VOTES');
```

### Status Transition (meeting.service.ts)

```ts
await withTx(async (tx) => {
  assertValidTransition(meeting.status, target); // map check first
  // ...evaluate guards for the specific transition...
  await tx.update(meetings).set({ status: target }).where(eq(meetings.id, meeting.id));
  await emitAudit(tx, {
    orgId,
    actorId: userId,
    event: 'meeting.status_changed',
    entityType: 'meeting',
    entityId: meeting.id,
    payload: { before: meeting.status, after: target },
  });
});
```

### Agenda Replace on Update (FR-310)

```ts
// when agendaItems supplied on PATCH:
await tx.delete(meetingAgendaItems).where(eq(meetingAgendaItems.meetingId, id));
await tx.insert(meetingAgendaItems).values(items); // (meeting_id, order_index) unique rejects dupes
```

### Idempotent Attendee Add (FR-308)

```ts
const inserted = await tx
  .insert(meetingAttendees)
  .values(memberIds.map((memberId) => ({ meetingId, memberId })))
  .onConflictDoNothing()
  .returning();
for (const row of inserted) {
  await emitAudit(tx, {
    event: 'meeting.attendee_added',
    entityType: 'meeting',
    entityId: meetingId,
    payload: { data: { memberId: row.memberId } },
  });
}
```

Only rows actually inserted emit an audit event — re-adding an existing
attendee is a silent no-op.

### app.ts Registration

```ts
const tagBySegment = { /* …existing… */ meetings: 'Meetings' };
// …in the /api/v1 scope:
await instance.register(meetingRoutes, { prefix: '/meetings' });
// …and add { name: 'Meetings', description: 'Meeting lifecycle and attendees' } to the swagger tags.
```

### Test Helper Addition

```ts
// tests/integration/helpers/db.ts
export async function truncateMeetingTables(): Promise<void> {
  const db = getDatabaseClient();
  await db.execute(sql`TRUNCATE meetings, meeting_agenda_items, meeting_attendees
    RESTART IDENTITY CASCADE`);
}
```

---

## Post-Design Constitution Re-check

After generating `research.md`, `data-model.md`, `contracts/`, and
`quickstart.md`:

| Principle                    | Status | Notes                                                                                                                                                      |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Code Quality              | Pass   | `state-machine.ts` is pure (no Fastify/DB import); single responsibility per file; the 15-minute window and page sizes are named constants in `constants/` |
| II. Testing Standards        | Pass   | 1 unit test file exhaustively covers the transition matrix; 5 integration files cover every FR/SC; rollback-injection tests confirm transactional audit    |
| III. API Design Consistency  | Pass   | 1 OpenAPI contract + 1 internal contract authored before implementation; all routes use the existing envelope; 2 new error codes registered                |
| IV. Performance Requirements | Pass   | Every hot-path query hits an existing index; guards are bounded fixed-cost; agenda replace and attendee add are single statements — no N+1                 |

**Post-design Constitution Check: PASS.** Ready for `/speckit-tasks`.
