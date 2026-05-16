# Research: Meetings Module

**Feature**: 004-meetings
**Date**: 2026-05-16
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

All technical unknowns are resolved below. There were no `NEEDS CLARIFICATION`
markers in the spec — the three open questions were resolved during
`/speckit-clarify` and are recorded in the spec's Clarifications section. The
decisions here cover module design choices the spec deliberately left to
planning.

---

## 1. Module layout

**Decision**: Create `src/modules/meetings/` with `meeting.controller.ts`,
`meeting.service.ts`, `meeting.routes.ts`, `public.ts`, `schemas/zod.ts`,
`types/request.ts`, `constants/index.ts`, `utils/state-machine.ts`, and
`pre-handlers/status-permission.ts`. The service queries Drizzle directly.

**Rationale**: Mirrors the `roles` and `members` modules, which keep DB access
in the service and have no separate repository file. Consistency across domain
modules outweighs the marginal isolation a repository layer would add.

**Alternatives considered**: A dedicated `meeting.repository.ts` (as `org` has) —
rejected; `org` predates the lighter pattern and the team has since favored
service-direct queries. A single flat file — rejected; violates Constitution I
(single responsibility).

---

## 2. Route shape

**Decision**: Flat routes under `/api/v1/meetings`, with `orgId` as a path
segment: `POST /meetings/org/:orgId`, `GET /meetings/org/:orgId`,
`GET /meetings/:meetingId/org/:orgId`, `PATCH /meetings/:meetingId/org/:orgId`,
`PATCH /meetings/:meetingId/org/:orgId/status`,
`POST /meetings/:meetingId/org/:orgId/attendees`,
`DELETE /meetings/:meetingId/org/:orgId/attendees/:memberId`.

**Rationale**: Matches the flat shape adopted by `roles`, `members`, and
`invitions`. The `attachOrgId` pre-handler already lifts `:orgId` from the path
into request context for permission and onboarding resolution.

**Alternatives considered**: Org-nested routes (`/orgs/:orgId/meetings`) as the
master IMPLEMENTATION-PLAN originally drafted — rejected; the implemented
codebase standardized on the flat shape in Phase 2.

---

## 3. Pre-handler chain

**Decision**: Every meeting route composes
`identityRequired → attachOrgId → requireOnboardingStep('complete') →
requirePermission(key)`. The status route swaps the last link for
`requireStatusTransitionPermission` (see §4).

**Rationale**: FR-314 requires meeting routes to be reachable only when org
onboarding is `COMPLETE`; the `complete` tier of the existing
`requireOnboardingStep` pre-handler enforces exactly that. The chain order
matches the established pattern in `role.routes.ts` / `member.routes.ts`.

**Alternatives considered**: A global onboarding middleware — rejected; the
codebase enforces onboarding per-route, not globally.

---

## 4. Status-transition permission

**Decision**: The single `PATCH …/status` endpoint is guarded by a module-local
pre-handler `requireStatusTransitionPermission` that reads `request.body.status`
and delegates to `requirePermission('meeting:cancel')` when the target is
`CANCELLED`, or `requirePermission('meeting:update')` otherwise.

**Rationale**: FR-313 requires `meeting:cancel` for cancellation and
`meeting:update` for every other transition. `requirePermission` accepts only a
static key, and Fastify makes the request body available at the `preHandler`
stage (schema validation runs first), so the target status can be inspected to
pick the key. This keeps a single status endpoint while honoring two distinct
permissions, and a caller holding only `meeting:cancel` can still cancel.

**Alternatives considered**: Two separate endpoints (one for cancel) — rejected;
the spec models a single status-transition operation. Checking the permission
inside the service — rejected; permission enforcement belongs in the pre-handler
layer for consistency with all other modules.

---

## 5. State machine as a pure module

**Decision**: `utils/state-machine.ts` exports a `MEETING_TRANSITIONS` map and
`assertValidTransition(from, to)`. It has no Fastify or DB import. Guards that
need DB state are evaluated separately in the service.

**Rationale**: A pure function is exhaustively unit-testable without a database
(Constitution II) — every (from, to) pair can be asserted in one fast test file.
Separating the static transition map from the data-dependent guards keeps each
concern single-purpose (Constitution I).

**Alternatives considered**: Embedding the transition logic in the service —
rejected; it would force a DB fixture for what is pure logic.

---

## 6. Open-votes guard (FR-306)

**Decision**: The `IN_PROGRESS → COMPLETED` guard counts rows in the `votes`
table where `meeting_id` matches and `status = 'OPEN'`; a non-zero count throws
`MEETING_HAS_OPEN_VOTES`.

**Rationale**: The `votes` table and its `votes_meeting_status_idx` index on
`(meeting_id, status)` already exist from Phase 0. Wiring the guard now (FR-306)
means no meeting-module change is needed when the vote module ships in Phase 4.
Because no vote rows exist yet, the count is always 0 and the guard passes
truthfully in the interim.

**Alternatives considered**: Deferring the guard to Phase 4 — rejected; the spec
(FR-306) and master plan both require it wired in Phase 3 so the contract is
stable.

---

## 7. Error codes

**Decision**: Add `INVALID_STATE_TRANSITION` (HTTP 422) and `MEETING_TOO_EARLY`
(HTTP 422) to `src/shared/errors/codes.ts`, with matching `AppError` factory
methods. Reuse the existing `MEETING_HAS_OPEN_VOTES` entry unchanged.

**Rationale**: 422 (Unprocessable Entity) is the right status for a
well-formed request that violates a state-machine rule, and matches the master
IMPLEMENTATION-PLAN error table. `MEETING_HAS_OPEN_VOTES` is already in the
registry at HTTP 409; it is left as-is to avoid changing an already-committed
constant — the discrepancy with the master plan's 422 is cosmetic and not worth
a breaking edit.

**Alternatives considered**: Reusing `CONFLICT` for invalid transitions —
rejected; a dedicated machine-readable code is required by Constitution III and
lets clients distinguish a transition error from a duplicate-resource error.

---

## 8. `scheduledAt` future validation (FR-317)

**Decision**: A Zod `.refine()` on the create and update schemas rejects a
`scheduledAt` that is not strictly in the future, surfaced as `VALIDATION_ERROR`.

**Rationale**: The constraint is a pure property of the input value, so it
belongs in the schema layer alongside all other field validation
(`fastify-type-provider-zod`). It needs no DB access.

**Alternatives considered**: A service-layer check — rejected; it would split
input validation across two layers for no benefit.

---

## 9. Agenda replace semantics (FR-310)

**Decision**: When an update request supplies `agendaItems`, the service deletes
all existing `meeting_agenda_items` for the meeting and re-inserts the supplied
set, inside the same transaction. When `agendaItems` is omitted, existing items
are untouched. An empty array removes all items.

**Rationale**: FR-310 specifies wholesale replacement, not a merge. The
`(meeting_id, order_index)` unique index rejects duplicate order positions at
the DB layer (FR-303). Doing the delete + insert in one transaction guarantees
the meeting is never left agenda-less mid-update.

**Alternatives considered**: Diff-and-merge of agenda items — rejected; the spec
explicitly chose replace semantics, and merge would need stable item IDs the
client does not supply.

---

## 10. Idempotent attendee add (FR-308)

**Decision**: Attendee add is a single bulk `INSERT … ON CONFLICT DO NOTHING`
against the `(meeting_id, member_id)` unique index. Only the rows actually
returned as inserted emit a `meeting.attendee_added` audit event. Every supplied
member id is first validated as a current membership of the meeting's org; if
any is not, the whole request is rejected before the insert.

**Rationale**: `onConflictDoNothing` makes re-adding an existing attendee a
harmless no-op (FR-308) without a prior existence query. Emitting audit only for
newly inserted rows keeps the log accurate.

**Alternatives considered**: Per-member `SELECT` then `INSERT` — rejected; an
N+1 pattern (Constitution IV). Upsert with `DO UPDATE` — rejected; there is no
non-key column to update on `meeting_attendees`.

---

## 11. Stale attendee links on member removal

**Decision**: Rely on the existing schema. `meeting_attendees.member_id`
references `memberships.id` with `onDelete: 'cascade'`, so removing a member
from an org automatically deletes their attendee rows across all meetings.

**Rationale**: The spec deferred this to planning. The Phase 0 schema already
made the call — a cascading FK — and it is the correct behavior: a non-member
should not remain a meeting attendee. No application code is needed.

**Alternatives considered**: Retaining the attendee row as historical record —
rejected; it would contradict the FK and leave dangling references that the
Phase 4 vote-eligibility logic would have to special-case.
