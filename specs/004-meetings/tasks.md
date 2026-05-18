---
description: 'Task list for the Meetings module (Phase 3)'
---

# Tasks: Meetings Module

**Input**: Design documents from `specs/004-meetings/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test tasks ARE included — the project constitution (Principle II:
Testing Standards) mandates TDD. Each story's tests are written first and must
fail before implementation.

**Organization**: Tasks are grouped by user story. The Meetings module is a
single cohesive Fastify module, so user-story phases share four files
(`meeting.service.ts`, `meeting.controller.ts`, `meeting.routes.ts`,
`schemas/zod.ts`) — see Dependencies for what this means for parallelism.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: User story the task belongs to (US1–US5)

## Path Conventions

Single-project modular monolith — `src/` and `tests/` at repository root.
New module lives in `src/modules/meetings/`.

---

## Phase 1: Setup

**Purpose**: Module skeleton and constants.

- [x] T001 Create the `src/modules/meetings/` directory tree — subfolders `schemas/`, `types/`, `constants/`, `utils/`, `pre-handlers/` — and an empty barrel `src/modules/meetings/public.ts`
- [x] T002 [P] Add meeting constants to `src/modules/meetings/constants/index.ts` — `MEETING_EARLY_OPEN_MINUTES = 15`, `MEETINGS_PAGE_SIZE_DEFAULT = 20`, `MEETINGS_PAGE_SIZE_MAX = 100`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared error codes, module wiring, and test infrastructure that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Add error codes `INVALID_STATE_TRANSITION` (httpStatus 422) and `MEETING_TOO_EARLY` (httpStatus 422) to `src/shared/errors/codes.ts`
- [x] T004 Add `invalidStateTransition(message?)` and `meetingTooEarly()` factory methods to `src/shared/errors/http-error.ts` (depends on T003)
- [x] T005 [P] Create the controller and service factory shells — `src/modules/meetings/meeting.controller.ts` (`createMeetingController(db)`) and `src/modules/meetings/meeting.service.ts` (`meetingService(db)`) — with empty method maps and a shared `findMeetingInOrgOrThrow` service helper
- [x] T006 [P] Create the routes shell `src/modules/meetings/meeting.routes.ts` exporting an (initially empty) `meetingRoutes` plugin, and re-export it from `src/modules/meetings/public.ts`
- [x] T007 Register `meetingRoutes` under prefix `/meetings` in `src/app.ts`, add `meetings: 'Meetings'` to `tagBySegment`, and add the `Meetings` tag to the Swagger config (depends on T006)
- [x] T008 [P] Add `truncateMeetingTables()` to `tests/integration/helpers/db.ts` — `TRUNCATE meetings, meeting_agenda_items, meeting_attendees RESTART IDENTITY CASCADE`

**Checkpoint**: Module is wired into the app; user-story implementation can begin.

---

## Phase 3: User Story 1 - Create a meeting with an agenda (Priority: P1) 🎯 MVP

**Goal**: A member with `meeting:create` can create a meeting (in `DRAFT`) with an optional ordered agenda, atomically with a `meeting.created` audit entry.

**Independent Test**: Authenticated member in an org with onboarding `COMPLETE` creates a meeting with two agenda items, then reads the meeting detail — verify `DRAFT` status and both agenda items in order; verify creation with no agenda items succeeds and a past `scheduledAt` is rejected.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [x] T009 [P] [US1] Integration test `tests/integration/modules/meetings/meeting-create.test.ts` — FR-301/302/303/317: create with/without agenda, status starts `DRAFT`, atomic rollback leaves no rows, non-future `scheduledAt` rejected, duplicate agenda `orderIndex` rejected

### Implementation for User Story 1

- [x] T010 [P] [US1] Add `createMeetingSchema` to `src/modules/meetings/schemas/zod.ts` (`title`, optional `description`/`location`, `scheduledAt` with future `.refine()`, optional `agendaItems[]`) plus its inferred request type in `src/modules/meetings/types/request.ts`
- [x] T011 [US1] Implement `createMeeting` in `src/modules/meetings/meeting.service.ts` — `withTx`: insert meeting `DRAFT`, insert agenda items, `emitAudit(tx, 'meeting.created')` (depends on T005, T010)
- [x] T012 [US1] Implement the `createMeeting` handler in `src/modules/meetings/meeting.controller.ts` (depends on T011)
- [x] T013 [US1] Register `POST /meetings/org/:orgId` in `src/modules/meetings/meeting.routes.ts` with pre-handlers `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:create')` (depends on T006, T012)

**Checkpoint**: Meetings can be created and read back — MVP is demonstrable.

---

## Phase 4: User Story 2 - Drive a meeting through its enforced status lifecycle (Priority: P1)

**Goal**: Members transition a meeting across the `DRAFT→SCHEDULED→IN_PROGRESS→COMPLETED` / `CANCELLED` state machine; every invalid transition and every failed guard is rejected at the server.

**Independent Test**: Create a meeting, run valid and invalid transitions — verify each valid one succeeds and each invalid one returns `INVALID_STATE_TRANSITION`; verify `SCHEDULED→IN_PROGRESS` is blocked too early (`MEETING_TOO_EARLY`) and with zero attendees, and succeeds within the window with ≥1 attendee.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [x] T014 [P] [US2] Unit test `tests/unit/modules/meetings/state-machine.test.ts` — every allowed transition passes, every other pair (incl. repeats, out of terminal states) throws `INVALID_STATE_TRANSITION`
- [x] T015 [P] [US2] Integration test `tests/integration/modules/meetings/meeting-status.test.ts` — FR-304/305/306/307: valid transitions, invalid rejected, `MEETING_TOO_EARLY`, zero-attendee block, open-votes guard, `meeting.status_changed` audit with `{before,after}`, `meeting:cancel` vs `meeting:update` permission

### Implementation for User Story 2

- [x] T016 [P] [US2] Implement `src/modules/meetings/utils/state-machine.ts` — `MEETING_TRANSITIONS` map and pure `assertValidTransition(from, to)`
- [x] T017 [P] [US2] Implement `requireStatusTransitionPermission` in `src/modules/meetings/pre-handlers/status-permission.ts` — picks `meeting:cancel` for a `CANCELLED` target, else `meeting:update`, then delegates to `requirePermission`
- [x] T018 [P] [US2] Add `transitionStatusSchema` to `src/modules/meetings/schemas/zod.ts` plus its request type in `types/request.ts`
- [x] T019 [US2] Implement `transitionStatus` in `src/modules/meetings/meeting.service.ts` — `withTx`: `assertValidTransition`, evaluate transition guards (attendee count, 15-min window, open-votes query on `votes`), update status, `emitAudit(tx, 'meeting.status_changed')` (depends on T016, T018)
- [x] T020 [US2] Implement the `transitionStatus` handler in `src/modules/meetings/meeting.controller.ts` (depends on T019)
- [x] T021 [US2] Register `PATCH /meetings/:meetingId/org/:orgId/status` in `meeting.routes.ts` with pre-handlers `identityRequired, attachOrgId, requireOnboardingStep('complete'), requireStatusTransitionPermission` (depends on T017, T020)

**Checkpoint**: A meeting can be driven through its full lifecycle with all guards enforced.

---

## Phase 5: User Story 3 - Manage meeting attendees (Priority: P1)

**Goal**: Members with `meeting:update` add/remove attendees (current org members only) while the meeting is `DRAFT`/`SCHEDULED`/`IN_PROGRESS`; adds are idempotent.

**Independent Test**: Create a meeting, add two org members, add one again (no duplicate), add a non-member (rejected), remove one — verify the attendee list and audit events; verify adds/removes on a `COMPLETED`/`CANCELLED` meeting are rejected.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [x] T022 [P] [US3] Integration test `tests/integration/modules/meetings/meeting-attendees.test.ts` — FR-308/309: idempotent add, non-member rejected, terminal-status rejected, remove, `meeting.attendee_added`/`meeting.attendee_removed` audit

### Implementation for User Story 3

- [x] T023 [P] [US3] Add `addAttendeesSchema` to `src/modules/meetings/schemas/zod.ts` plus request types in `types/request.ts`
- [x] T024 [US3] Implement `addAttendees` and `removeAttendee` in `src/modules/meetings/meeting.service.ts` — validate every `memberId` is a current org membership, enforce the `DRAFT`/`SCHEDULED`/`IN_PROGRESS` window, `INSERT … ON CONFLICT DO NOTHING`, `emitAudit` per newly added row and on removal (depends on T005, T023)
- [x] T025 [US3] Implement the `addAttendees` and `removeAttendee` handlers in `src/modules/meetings/meeting.controller.ts` (depends on T024)
- [x] T026 [US3] Register `POST /meetings/:meetingId/org/:orgId/attendees` and `DELETE /meetings/:meetingId/org/:orgId/attendees/:memberId` in `meeting.routes.ts` with `requirePermission('meeting:update')` (depends on T006, T025)

**Checkpoint**: All three P1 stories work — a complete create→schedule→attendee→lifecycle slice is demonstrable.

---

## Phase 6: User Story 4 - List and view meetings (Priority: P2)

**Goal**: Members with `meeting:read` list meetings (filtered, cursor-paginated) and open a single meeting with its agenda and attendees.

**Independent Test**: Create meetings across statuses and dates, list with each filter (`status`, `from`, `to`, `attendeeId`) and page through — verify correct filtered results; open one meeting and verify agenda + attendees are returned.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [x] T027 [P] [US4] Integration test `tests/integration/modules/meetings/meeting-list.test.ts` — FR-311/312: each filter, cursor pagination + `nextCursor`, detail returns agenda + attendees

### Implementation for User Story 4

- [x] T028 [P] [US4] Add `listMeetingsSchema` (query: `status`, `from`, `to`, `attendeeId`, `cursor`, `limit`) to `src/modules/meetings/schemas/zod.ts` plus request types in `types/request.ts`
- [x] T029 [US4] Implement `listMeetings` (keyset pagination via `applyKeysetWhere`, status/range/attendee filters) and `getMeeting` (detail with agenda + attendees) in `src/modules/meetings/meeting.service.ts` (depends on T005, T028)
- [x] T030 [US4] Implement the `listMeetings` and `getMeeting` handlers in `src/modules/meetings/meeting.controller.ts` (depends on T029)
- [x] T031 [US4] Register `GET /meetings/org/:orgId` and `GET /meetings/:meetingId/org/:orgId` in `meeting.routes.ts` with `requirePermission('meeting:read')` (depends on T006, T030)

**Checkpoint**: Meetings are browsable and viewable.

---

## Phase 7: User Story 5 - Edit meeting details before it starts (Priority: P2)

**Goal**: Members with `meeting:update` edit meeting details while `DRAFT`/`SCHEDULED`; supplying agenda items replaces the agenda wholesale; edits are frozen once `IN_PROGRESS`+.

**Independent Test**: Edit a `DRAFT` meeting's title and agenda (verify replace, not merge), move it to `IN_PROGRESS`, attempt another edit (rejected with `INVALID_STATE_TRANSITION`), and verify a non-future `scheduledAt` edit is rejected.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [x] T032 [P] [US5] Integration test `tests/integration/modules/meetings/meeting-update.test.ts` — FR-310/317: edit in `DRAFT`/`SCHEDULED`, agenda wholesale replace, frozen in `IN_PROGRESS`+, non-future `scheduledAt` rejected, `meeting.updated` audit

### Implementation for User Story 5

- [x] T033 [P] [US5] Add `updateMeetingSchema` (all fields optional, `scheduledAt` future `.refine()`, optional `agendaItems[]`) to `src/modules/meetings/schemas/zod.ts` plus request types in `types/request.ts`
- [x] T034 [US5] Implement `updateMeeting` in `src/modules/meetings/meeting.service.ts` — enforce `DRAFT`/`SCHEDULED` edit window, replace agenda items inside `withTx` when supplied, `emitAudit(tx, 'meeting.updated')` (depends on T005, T033)
- [x] T035 [US5] Implement the `updateMeeting` handler in `src/modules/meetings/meeting.controller.ts` (depends on T034)
- [x] T036 [US5] Register `PATCH /meetings/:meetingId/org/:orgId` in `meeting.routes.ts` with `requirePermission('meeting:update')` (depends on T006, T035)

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, quality gates, and end-to-end validation.

- [ ] T037 [P] Regenerate the OpenAPI document (`src/scripts/gen-openapi.ts`) and confirm all 7 meeting endpoints appear in `docs/openapi.json`
- [ ] T038 [P] Run the linter and formatter — zero warnings (Constitution I)
- [ ] T039 Run the full meeting test suite (`pnpm test tests/unit/modules/meetings tests/integration/modules/meetings`) and confirm coverage ≥ 80% (Constitution II)
- [ ] T040 Execute `specs/004-meetings/quickstart.md` end-to-end against a running server and confirm all 5 audit events

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **User Stories (Phases 3–7)**: each depends on Foundational completion.
- **Polish (Phase 8)**: depends on all user stories being complete.

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. Pure creation path.
- **US2 (P1)**: depends only on Foundational. Logically independent of US1, but its tests reuse the create path.
- **US3 (P1)**: depends only on Foundational. Its tests reuse create + status transitions.
- **US4 (P2)**: depends only on Foundational. Its tests reuse the create path.
- **US5 (P2)**: depends only on Foundational. Its tests reuse create + status transitions.

### Shared-file note (affects parallelism across stories)

US1–US5 each append to the same four files — `meeting.service.ts`,
`meeting.controller.ts`, `meeting.routes.ts`, and `schemas/zod.ts`. The stories
are _logically_ independent and independently testable, but their
service/controller/route/schema tasks **serialize on these files**. Treat the
stories as sequential by priority (US1 → US2 → US3 → US4 → US5) unless a
developer takes a whole story end-to-end on a branch.

### Within Each User Story

- Tests are written first and must fail before implementation.
- Schema → service → controller → route (each depends on the previous).
- `[P]` tasks within a story touch distinct files (e.g. the test file, the
  schema file, and — in US2 — the state machine and the pre-handler).

---

## Parallel Example: User Story 2

```bash
# Tests for US2 (distinct files) can be written together:
Task: "Unit test tests/unit/modules/meetings/state-machine.test.ts"
Task: "Integration test tests/integration/modules/meetings/meeting-status.test.ts"

# Then the distinct implementation files can proceed in parallel:
Task: "Implement src/modules/meetings/utils/state-machine.ts"
Task: "Implement src/modules/meetings/pre-handlers/status-permission.ts"
Task: "Add transitionStatusSchema to src/modules/meetings/schemas/zod.ts"
# meeting.service.ts → controller → route then run sequentially.
```

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) → Phase 2 (Foundational).
2. Phase 3 (US1) → **stop and validate**: meetings can be created and read.
3. US1 is the smallest shippable increment. A meaningful lifecycle demo,
   however, needs all three P1 stories (US1–US3).

### Incremental Delivery

1. Setup + Foundational → module wired in.
2. US1 → create/read meetings (MVP).
3. US2 → status lifecycle with guards.
4. US3 → attendee management → full P1 slice demonstrable.
5. US4 → list/view (P2).
6. US5 → edit-before-start (P2).

### Suggested MVP Scope

**US1 only** for the first checkpoint; **US1 + US2 + US3** (all P1) for the first
genuinely useful release of the Meetings module.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[Story]` label maps each task to a user story for traceability.
- Verify every test fails before implementing against it (TDD — Constitution II).
- No schema changes — `meetings`, `meeting_agenda_items`, `meeting_attendees`
  already exist from Phase 0.
- Commit after each task or logical group; stop at any checkpoint to validate.
