# Feature Specification: Meetings Module

**Feature Branch**: `004-meetings`
**Created**: 2026-05-16
**Status**: Draft
**Input**: User description: "we want to implement the phase-3 — Meetings module of the implementation plan"

## Clarifications

### Session 2026-05-16

- Q: Which meeting permission keys should this feature use — the names in the
  Phase 3 prose of the implementation plan (`meeting:view`, `meeting:change_status`,
  `meeting:manage_attendees`) or the implemented permission set? → A: Use the
  implemented permission set (`meeting:create`, `meeting:read`, `meeting:update`,
  `meeting:cancel`, `meeting:delete`). Operations map as: create →
  `meeting:create`; list and detail → `meeting:read`; edit details, status
  transitions, and attendee add/remove → `meeting:update`; the transition to
  `CANCELLED` → `meeting:cancel`. `meeting:delete` is intentionally unused —
  meetings are never hard-deleted.
- Q: Are attendee add/remove operations gated by meeting status? → A: Yes —
  allowed while the meeting is `DRAFT`, `SCHEDULED`, or `IN_PROGRESS`; rejected
  once the meeting is `COMPLETED` or `CANCELLED`.
- Q: Is at least one agenda item required to create a meeting? → A: No — agenda
  items are optional; a meeting may be created with an empty agenda and have
  items added later via editing.
- Q: Must `scheduledAt` be in the future? → A: Yes — `scheduledAt` must be in
  the future both when a meeting is created and when its scheduled time is
  edited.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Create a meeting with an agenda (Priority: P1)

A member with meeting-creation permission schedules a meeting for their
organization, giving it a title, an optional description and location, a
scheduled time, and an ordered list of agenda items. The meeting is created in
a `DRAFT` state — not yet visible as an active commitment — so it can be refined
before being published.

**Why this priority**: A meeting is the container for every Phase 3 and Phase 4
governance activity — agendas, attendees, votes, and minutes all hang off it.
Nothing else in the meeting lifecycle can be exercised until a meeting exists.

**Independent Test**: Authenticate as a member with `meeting:create` in an org
whose onboarding is `COMPLETE`, create a meeting with two agenda items, then
fetch the meeting detail — verify the meeting exists in `DRAFT` status with both
agenda items in the supplied order.

**Acceptance Scenarios**:

1. **Given** a member with `meeting:create` in an org with onboarding
   `COMPLETE`, **When** they create a meeting with a title, a `scheduledAt`
   time, and an ordered list of agenda items, **Then** the meeting is created
   with status `DRAFT`, the agenda items are persisted in the supplied order,
   and a `meeting.created` audit entry is written — all in one transaction.
2. **Given** a meeting creation request, **When** any agenda item or the
   meeting row fails to persist, **Then** the whole transaction rolls back —
   no meeting and no agenda items remain, and no audit entry is written.
3. **Given** a created meeting, **When** the creator reads the meeting detail,
   **Then** the response includes the meeting's status, scheduled time, agenda
   items, and (initially empty) attendee list.
4. **Given** a member with `meeting:create`, **When** they create a meeting
   with no agenda items, **Then** the meeting is created in `DRAFT` with an
   empty agenda — agenda items are optional at creation.
5. **Given** a meeting creation request whose `scheduledAt` is not in the
   future, **When** it is processed, **Then** the request is rejected and no
   meeting is created.

---

### User Story 2 - Drive a meeting through its enforced status lifecycle (Priority: P1)

A member with the appropriate permission moves a meeting through its lifecycle:
`DRAFT → SCHEDULED → IN_PROGRESS → COMPLETED`, or cancels it from `SCHEDULED` or
`IN_PROGRESS`. The server validates every transition against a fixed map and
evaluates the guards for each — clients cannot skip steps, reverse a terminal
state, or open a meeting prematurely.

**Why this priority**: The status state machine is the integrity backbone of the
module. Votes may only be created against an `IN_PROGRESS` meeting and minutes
only against a `COMPLETED` one (Phase 4), so an unguarded transition would let
those downstream invariants be bypassed.

**Independent Test**: Create a meeting, then attempt transitions in and out of
order — verify each valid transition succeeds and each invalid one is rejected
with `INVALID_STATE_TRANSITION`. Attempt `SCHEDULED → IN_PROGRESS` both outside
and inside the 15-minute window, and with and without attendees.

**Acceptance Scenarios**:

1. **Given** a meeting in `DRAFT`, **When** a permitted caller transitions it to
   `SCHEDULED`, **Then** the status updates and a `meeting.status_changed` audit
   entry recording `{ before, after }` is written.
2. **Given** a meeting in `SCHEDULED` with at least one attendee, **When** a
   permitted caller transitions it to `IN_PROGRESS` and the current time is at
   or after `scheduledAt − 15 minutes`, **Then** the transition succeeds.
3. **Given** a meeting in `SCHEDULED`, **When** a transition to `IN_PROGRESS` is
   requested more than 15 minutes before `scheduledAt`, **Then** the request is
   rejected with `MEETING_TOO_EARLY` and the status is unchanged.
4. **Given** a meeting in `SCHEDULED` with zero attendees, **When** a transition
   to `IN_PROGRESS` is requested, **Then** the request is rejected and the
   status is unchanged.
5. **Given** a meeting in `IN_PROGRESS`, **When** a permitted caller transitions
   it to `COMPLETED` and no vote attached to the meeting is open, **Then** the
   transition succeeds. **When** an open vote exists, **Then** the request is
   rejected with `MEETING_HAS_OPEN_VOTES`. (No votes can exist before Phase 4,
   so this guard passes truthfully until then.)
6. **Given** a meeting in `SCHEDULED` or `IN_PROGRESS`, **When** a caller with
   `meeting:cancel` cancels it, **Then** the status becomes `CANCELLED` and a
   `meeting.status_changed` audit entry is written.
7. **Given** a meeting in `CANCELLED` or `COMPLETED`, **When** any further
   transition is requested, **Then** the request is rejected with
   `INVALID_STATE_TRANSITION` — terminal states are final.
8. **Given** any meeting, **When** a transition not present in the allowed map
   is requested (e.g. `DRAFT → IN_PROGRESS`, `DRAFT → COMPLETED`,
   `IN_PROGRESS → SCHEDULED`), **Then** the request is rejected with
   `INVALID_STATE_TRANSITION`.

---

### User Story 3 - Manage meeting attendees (Priority: P1)

A member with meeting-management permission adds organization members as
attendees of a meeting and removes them. Only current members of the meeting's
organization may be added. Adding a member who is already an attendee is
harmless and does not create a duplicate.

**Why this priority**: At least one attendee is a precondition for opening a
meeting (User Story 2), and the attendee set defines the eligible voter pool in
Phase 4. Attendee management must ship alongside the lifecycle it gates.

**Independent Test**: Create a meeting, add two org members as attendees, add
one of them again (verify no duplicate), attempt to add a user who is not a
member of the org (verify rejection), then remove an attendee and confirm the
attendee list reflects every change.

**Acceptance Scenarios**:

1. **Given** a meeting and a set of member identifiers that are all current
   memberships of the meeting's org, **When** a caller with `meeting:update`
   adds them as attendees, **Then** each becomes an attendee and a
   `meeting.attendee_added` audit entry is written per newly added member.
2. **Given** an attendee-add request that includes an identifier that is not a
   current membership of the meeting's org, **When** it is processed, **Then**
   the request is rejected and no attendee rows are added.
3. **Given** a member who is already an attendee, **When** they are added
   again, **Then** the operation succeeds without creating a duplicate attendee
   and without emitting a second `meeting.attendee_added` entry.
4. **Given** an existing attendee, **When** a caller with `meeting:update`
   removes them, **Then** the attendee link is deleted and a
   `meeting.attendee_removed` audit entry is written.
5. **Given** a meeting in `COMPLETED` or `CANCELLED`, **When** an attendee add
   or remove is attempted, **Then** the request is rejected with
   `INVALID_STATE_TRANSITION` and the attendee set is unchanged. Attendee
   management is permitted only while the meeting is `DRAFT`, `SCHEDULED`, or
   `IN_PROGRESS`.

---

### User Story 4 - List and view meetings (Priority: P2)

A member with meeting-read permission browses the organization's meetings with
filters and pagination, and opens any single meeting to see its full detail
including agenda and attendees.

**Why this priority**: Visibility is essential for day-to-day use but depends on
meetings already existing and being managed (User Stories 1–3). It carries no
state-integrity risk, so it ranks below the write paths.

**Independent Test**: Create several meetings across different statuses and
scheduled dates, then list with each filter (`status`, `from`, `to`,
`attendeeId`) and page through the results — verify the filtered, paginated set
is correct and stable, and that opening a single meeting returns its agenda and
attendees.

**Acceptance Scenarios**:

1. **Given** an org with multiple meetings, **When** a caller with
   `meeting:read` lists meetings, **Then** results are returned in pages using
   cursor-based pagination consistent with the platform convention.
2. **Given** a list request with a `status`, `from`, `to`, or `attendeeId`
   filter, **When** it is processed, **Then** only meetings matching every
   supplied filter are returned.
3. **Given** a meeting identifier, **When** a caller with `meeting:read`
   requests its detail, **Then** the response includes the meeting fields, the
   ordered agenda items, and the attendee list.

---

### User Story 5 - Edit meeting details before it starts (Priority: P2)

A member with meeting-update permission revises a meeting's details — title,
description, location, scheduled time, or agenda — while it is still `DRAFT` or
`SCHEDULED`. Once a meeting is `IN_PROGRESS` or later, its details are frozen.

**Why this priority**: Plans change before a meeting happens, so editing is
expected. Freezing details once the meeting starts protects the integrity of the
record that votes and minutes will be attached to in Phase 4.

**Independent Test**: Create a meeting, edit its title and agenda while `DRAFT`
(verify success), move it to `IN_PROGRESS`, attempt another edit (verify
rejection), and confirm that supplying agenda items on an edit replaces the
prior set entirely.

**Acceptance Scenarios**:

1. **Given** a meeting in `DRAFT` or `SCHEDULED`, **When** a caller with
   `meeting:update` edits any subset of its details, **Then** the changes are
   saved and a `meeting.updated` audit entry is written.
2. **Given** an edit request that supplies a new set of agenda items, **When**
   it is processed, **Then** the meeting's prior agenda items are fully replaced
   by the supplied set in the supplied order — no merge.
3. **Given** a meeting in `IN_PROGRESS`, `COMPLETED`, or `CANCELLED`, **When** an
   edit of its details is attempted, **Then** the request is rejected with
   `INVALID_STATE_TRANSITION` and nothing is changed.
4. **Given** a meeting in `DRAFT` or `SCHEDULED`, **When** an edit sets
   `scheduledAt` to a time that is not in the future, **Then** the request is
   rejected and the meeting is unchanged.

---

### Edge Cases

- Requesting a transition that repeats the current status (e.g. `DRAFT → DRAFT`)
  — treated as not present in the allowed map and rejected with
  `INVALID_STATE_TRANSITION`.
- Opening a meeting exactly at the boundary `scheduledAt − 15 minutes` — the
  guard is inclusive, so the transition is allowed at that instant.
- A meeting whose `scheduledAt` is already in the past — there is no upper bound
  on the open window, so `SCHEDULED → IN_PROGRESS` is still permitted (only the
  early-open guard applies).
- The last attendee of a `SCHEDULED` meeting is removed, then an open is
  attempted — rejected for having zero attendees.
- An attendee-add request containing a member identifier that belongs to a
  different organization — rejected; org scoping is enforced.
- A member who is an attendee of a meeting is later removed from the
  organization — handling of the now-stale attendee link (cascade vs. retain)
  is an implementation concern noted in Assumptions.
- Two callers concurrently transition the same meeting — exactly one transition
  is applied; the other observes the already-changed status and is rejected by
  the transition validator.
- An edit that supplies an empty agenda list — interpreted as "remove all
  agenda items"; an edit that omits the agenda field entirely — leaves agenda
  items untouched.
- Agenda items supplied with duplicate or non-contiguous order positions — order
  positions must be unique within a meeting; duplicates are rejected.
- Creating a meeting, or editing one to set `scheduledAt`, with a time that is
  not in the future — rejected; the scheduled time must be in the future.
- Adding or removing an attendee of a `COMPLETED` or `CANCELLED` meeting —
  rejected with `INVALID_STATE_TRANSITION`; the attendee set of a terminal-state
  meeting is frozen.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-301**: System MUST allow a member holding `meeting:create` to create a
  meeting within their organization. Creation MUST atomically: insert the
  meeting with status `DRAFT`, insert all supplied agenda items, and emit a
  `meeting.created` audit entry — all in a single database transaction. If any
  step fails, the entire transaction MUST roll back with no partial state.
  Supplying agenda items is optional — a meeting MAY be created with an empty
  agenda, with items added later via editing.

- **FR-302**: A meeting MUST carry a title, a scheduled time, and a status; it
  MAY carry a description and a location. A meeting is always scoped to exactly
  one organization.

- **FR-303**: Agenda items MUST belong to exactly one meeting and MUST carry an
  order position that is unique within that meeting. An attempt to create a
  meeting (or edit its agenda) with duplicate order positions MUST be rejected.

- **FR-304**: System MUST enforce the meeting status state machine. The only
  permitted transitions are: `DRAFT → SCHEDULED`, `SCHEDULED → IN_PROGRESS`,
  `SCHEDULED → CANCELLED`, `IN_PROGRESS → COMPLETED`, and
  `IN_PROGRESS → CANCELLED`. Any other requested transition — including
  skipping a state, reversing a transition, repeating the current status, or
  transitioning out of `COMPLETED` or `CANCELLED` — MUST be rejected with
  `INVALID_STATE_TRANSITION`.

- **FR-305**: The `SCHEDULED → IN_PROGRESS` transition MUST be guarded: it MUST
  be rejected unless the meeting has at least one attendee AND the current time
  is at or after `scheduledAt − 15 minutes`. A transition attempted too early
  MUST be rejected with `MEETING_TOO_EARLY`. The 15-minute boundary is
  inclusive.

- **FR-306**: The `IN_PROGRESS → COMPLETED` transition MUST be guarded against
  open votes: if any vote attached to the meeting is in an open state, the
  transition MUST be rejected with `MEETING_HAS_OPEN_VOTES`. This guard MUST be
  wired in this feature; because no votes exist until Phase 4 it passes
  truthfully until then, and gains real effect when the vote module ships.

- **FR-307**: Every status transition MUST emit a `meeting.status_changed` audit
  entry whose payload records the `before` and `after` status, written inside
  the same transaction as the status update.

- **FR-308**: System MUST allow a member holding `meeting:update` to add
  attendees to a meeting. Every supplied attendee identifier MUST be validated
  as a current membership of the meeting's organization; if any is not, the
  whole request MUST be rejected and no attendee added. Adding a member who is
  already an attendee MUST be idempotent — no duplicate link and no second
  audit entry. Each newly added attendee MUST emit a `meeting.attendee_added`
  audit entry. Attendee additions MUST be permitted only while the meeting is
  `DRAFT`, `SCHEDULED`, or `IN_PROGRESS`; an addition attempted against a
  `COMPLETED` or `CANCELLED` meeting MUST be rejected with
  `INVALID_STATE_TRANSITION`.

- **FR-309**: System MUST allow a member holding `meeting:update` to remove an
  attendee from a meeting. Removal MUST delete the attendee link and emit a
  `meeting.attendee_removed` audit entry. Attendee removals MUST be permitted
  only while the meeting is `DRAFT`, `SCHEDULED`, or `IN_PROGRESS`; a removal
  attempted against a `COMPLETED` or `CANCELLED` meeting MUST be rejected with
  `INVALID_STATE_TRANSITION`.

- **FR-310**: System MUST allow a member holding `meeting:update` to edit a
  meeting's details (title, description, location, scheduled time, agenda) only
  while the meeting is in `DRAFT` or `SCHEDULED`. An edit attempted in any other
  status MUST be rejected with `INVALID_STATE_TRANSITION`. When an edit supplies
  agenda items, the meeting's existing agenda items MUST be fully replaced by
  the supplied set; when the agenda is omitted, existing items MUST be left
  unchanged.

- **FR-311**: System MUST provide a meeting list, readable by members holding
  `meeting:read`, that supports filtering by `status`, by a scheduled-time range
  (`from` / `to`), and by `attendeeId`, and that is paged using cursor-based
  pagination consistent with the platform HTTP conventions (default 20, max 100
  per page).

- **FR-312**: System MUST provide a meeting detail view, readable by members
  holding `meeting:read`, that returns the meeting fields together with its
  ordered agenda items and its attendee list.

- **FR-313**: Permission requirements MUST be enforced per operation: meeting
  creation requires `meeting:create`; listing and detail require `meeting:read`;
  editing details, transitioning status, and adding or removing attendees
  require `meeting:update`; transitioning a meeting to `CANCELLED` requires
  `meeting:cancel`. Permissions MUST be resolved per-request, and the org Owner
  bypass applies as in prior phases.

- **FR-314**: All meeting routes MUST be reachable only when the organization's
  onboarding step is `COMPLETE`; requests against an org still in onboarding
  MUST be blocked, consistent with the server-enforced onboarding principle.

- **FR-315**: System MUST emit audit log entries for all 5 meeting events:
  `meeting.created`, `meeting.updated`, `meeting.status_changed`,
  `meeting.attendee_added`, and `meeting.attendee_removed`. Each entry MUST be
  written inside the same transaction as its originating write using the shared
  audit emitter; no audit entry may outlive a rolled-back transaction.

- **FR-316**: Meetings MUST NOT be hard-deleted. A meeting that should not
  proceed is moved to `CANCELLED` via the status state machine; there is no
  delete operation.

- **FR-317**: A meeting's `scheduledAt` MUST be a time in the future. The
  constraint MUST be enforced both at creation and whenever an edit changes
  `scheduledAt`; a request supplying a non-future `scheduledAt` MUST be rejected
  and no change persisted. A meeting validly created with a future time whose
  scheduled moment later passes is unaffected — it remains openable per the
  `SCHEDULED → IN_PROGRESS` guard.

### Key Entities

- **Meeting**: A scheduled governance gathering scoped to one organization.
  Holds a title, optional description and location, a scheduled time, and a
  lifecycle status (`DRAFT` / `SCHEDULED` / `IN_PROGRESS` / `COMPLETED` /
  `CANCELLED`). Owns its agenda items and its attendee links.

- **Agenda Item**: An ordered topic line belonging to a single meeting. Carries
  a title, an optional description, and an order position unique within the
  meeting.

- **Meeting Attendee**: A link between a meeting and an organization membership,
  marking that member as expected at the meeting. The attendee set is the
  precondition for opening a meeting and the basis for voter eligibility in
  Phase 4.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-301**: 100% of meeting-creation test scenarios that inject a forced
  mid-transaction failure leave zero meeting and zero agenda-item rows behind.

- **SC-302**: 100% of invalid status transitions — skipped states, reversed
  transitions, repeated status, or transitions out of a terminal state — are
  rejected with `INVALID_STATE_TRANSITION`; no invalid transition is ever
  applied.

- **SC-303**: 100% of `SCHEDULED → IN_PROGRESS` attempts made more than 15
  minutes before `scheduledAt`, or with zero attendees, are blocked; the
  transition succeeds only inside the window with at least one attendee.

- **SC-304**: 100% of attendee-add attempts that include a user who is not a
  current member of the meeting's organization are rejected, and no attendee
  link is created for any identifier in a rejected request.

- **SC-305**: 100% of edit attempts against a meeting in `IN_PROGRESS`,
  `COMPLETED`, or `CANCELLED` are rejected with `INVALID_STATE_TRANSITION`.

- **SC-306**: All 5 meeting audit events are present in the log after exercising
  each meeting flow end-to-end, and each was written in the same transaction as
  its originating write (verified by rollback injection).

- **SC-307**: All meeting endpoints respond within 200 ms at p95 against a
  database holding at least 1,000 meetings, matching the platform-wide latency
  budget.

## Assumptions

- The full schema (including `meetings`, `meeting_agenda_items`, and
  `meeting_attendees`) was delivered in Phase 0 and is available without
  modification. This feature introduces no new tables and alters no columns.
- The identity pre-handler (Phase 1), the permission guard and audit emitter
  (Phase 0), and the onboarding-enforcement pre-handler (Phase 2) are available
  and are reused without modification.
- This feature uses the implemented permission set in `src/shared/permissions/set.ts`
  (`meeting:create`, `meeting:read`, `meeting:update`, `meeting:cancel`,
  `meeting:delete`). `meeting:delete` is intentionally left unused for this
  feature, since meetings are cancelled rather than deleted.
- The Phase 3 prose in `docs/IMPLEMENTATION-PLAN.md` still cites older permission
  names (`meeting:view`, `meeting:change_status`, `meeting:manage_attendees`);
  this spec deliberately uses the implemented keys instead. Reconciling that
  prose is a separate documentation edit, outside this feature's scope.
- The `IN_PROGRESS → COMPLETED` open-votes guard is wired in this feature but
  cannot be exercised with real data until the vote module ships in Phase 4;
  until then it passes truthfully.
- Attendees reference organization memberships. If a member is removed from the
  organization after being added as an attendee, the resolution of the stale
  attendee link (cascade removal vs. retention) is an implementation detail to
  be decided during planning.
- The exact HTTP route shape (flat vs. org-nested) for meeting endpoints is an
  implementation detail to be decided during `/speckit-plan`, consistent with
  the conventions established in prior phases.
- Cursor-based pagination for the meeting list follows the platform HTTP
  conventions from Phase 0 (default 20, max 100 per page).
- Rate limiting and any export of meeting data are out of scope for this
  feature.
