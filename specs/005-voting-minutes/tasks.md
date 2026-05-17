---
description: 'Task list for Voting & Minutes (Phase 4)'
---

# Tasks: Voting & Minutes

**Input**: Design documents from `specs/005-voting-minutes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test tasks ARE included — the project constitution (Principle II:
Testing Standards) mandates TDD. Each story's tests are written first and must
fail before implementation.

**Organization**: Tasks are grouped by user story. This feature ships **two
independent modules** — `votes` (US1–US3, plus the votes half of US7) and
`minutes` (US4–US6, plus the minutes half of US7). The two modules share no
code, so their tracks can run fully in parallel; see Dependencies.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: User story the task belongs to (US1–US7)

## Path Conventions

Single-project modular monolith — `src/` and `tests/` at repository root. New
modules live in `src/modules/votes/` and `src/modules/minutes/`.

---

## Phase 1: Setup

**Purpose**: Module skeletons, constants, and the one new dependency.

- [X] T001 [P] Create the `src/modules/votes/` directory tree — subfolders `schemas/`, `types/`, `constants/`, `utils/` — and an empty barrel `src/modules/votes/public.ts`
- [X] T002 [P] Create the `src/modules/minutes/` directory tree — subfolders `schemas/`, `types/`, `utils/` — and an empty barrel `src/modules/minutes/public.ts`
- [X] T003 [P] Add vote-list pagination constants to `src/modules/votes/constants/index.ts` — `VOTES_PAGE_SIZE_DEFAULT = 20`, `VOTES_PAGE_SIZE_MAX = 100`
- [X] T004 Install `pdfkit` and `@types/pdfkit`, pinned to exact versions in `package.json` (Technical Standards — no unpinned ranges), for the minutes PDF export (research Decision 9)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema migration, shared error codes, the identity-only
pre-handler, module wiring, and test infrastructure that every user story
depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Add `affirmativeOption: text('affirmative_option').notNull()` to the `votes` table in `src/db/schema/vote.ts`, then run `pnpm db:generate` to emit the additive migration `src/db/migrations/0003_*.sql` (research Decision 2; data-model.md)
- [X] T006 Add error codes `VOTE_CLOSED` (httpStatus 422) and `MINUTES_FINALIZED` (httpStatus 422) to `src/shared/errors/codes.ts`
- [X] T007 Add `voteClosed(message?)` and `minutesFinalized(message?)` factory methods to `src/shared/errors/http-error.ts` (depends on T006)
- [X] T008 [P] Create the identity-only pre-handler `src/shared/http/pre-handlers/require-membership.ts` exporting `requireMembership` — resolves the caller's org membership, sets `request.orgMembership`, throws `FORBIDDEN` if not a member, performs no permission-key check (research Decision 10)
- [X] T009 [P] Create the votes controller and service factory shells — `src/modules/votes/vote.controller.ts` (`createVoteController(db)`) and `src/modules/votes/vote.service.ts` (`voteService(db)`) — with empty method maps and shared service helpers `findMeetingInOrgOrThrow`, `findVoteInMeetingOrThrow`, and `resolveCallerMembershipId`
- [X] T010 [P] Create the minutes controller and service factory shells — `src/modules/minutes/minutes.controller.ts` (`createMinutesController(db)`) and `src/modules/minutes/minutes.service.ts` (`minutesService(db)`) — with empty method maps and shared service helpers `findMeetingInOrgOrThrow` and `findMinutesForMeetingOrThrow`
- [X] T011 [P] Create the votes routes shell `src/modules/votes/vote.routes.ts` exporting an (initially empty) `voteRoutes` plugin, and re-export it from `src/modules/votes/public.ts`
- [X] T012 [P] Create the minutes routes shell `src/modules/minutes/minutes.routes.ts` exporting an (initially empty) `minutesRoutes` plugin, and re-export it from `src/modules/minutes/public.ts`
- [X] T013 Register `voteRoutes` under prefix `/votes` and `minutesRoutes` under prefix `/minutes` in `src/app.ts`, add `votes: 'Voting'` and `minutes: 'Minutes'` to `tagBySegment`, and add the `Voting` and `Minutes` tags to the Swagger config (depends on T011, T012)
- [X] T014 [P] Add `truncateVoteTables()` (`TRUNCATE votes, vote_eligibility, ballots RESTART IDENTITY CASCADE`) and `truncateMinutesTables()` (`TRUNCATE minutes, minutes_resolutions, minutes_corrections RESTART IDENTITY CASCADE`) to `tests/integration/helpers/db.ts`
- [X] T015 [P] Create `tests/integration/modules/votes/helpers.ts` — `setupVoteContext` builds a verified user, an org with onboarding `COMPLETE`, and a meeting driven to `IN_PROGRESS` with attendees
- [X] T016 [P] Create `tests/integration/modules/minutes/helpers.ts` — `setupMinutesContext` builds a verified user, an org with onboarding `COMPLETE`, a `COMPLETED` meeting, and one `CLOSED` vote (direct insert, using the `affirmative_option` column) for resolution tests

**Checkpoint**: Both modules are wired into the app; user-story implementation can begin. The `votes` and `minutes` tracks are now independent.

---

## Phase 3: User Story 1 - Create a formal vote with an immutable eligibility snapshot (Priority: P1) 🎯 MVP

**Goal**: A member with `vote:create` opens a vote inside an `IN_PROGRESS` meeting; the eligible voter set is frozen as an immutable snapshot, atomically with a `vote.created` audit entry.

**Independent Test**: Authenticate as a member with `vote:create` in an org with onboarding `COMPLETE`, drive a meeting to `IN_PROGRESS` with two attendees, create a vote with `eligibleMemberIds` left null, add a third attendee — fetch the vote and verify the eligible set still holds exactly the original two members.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T017 [P] [US1] Integration test `tests/integration/modules/votes/vote-create.test.ts` — FR-401/402/403/404: create against an `IN_PROGRESS` meeting (status `OPEN`, eligibility rows inserted, `vote.created` audit); non-`IN_PROGRESS` meeting → `INVALID_STATE_TRANSITION`; null `eligibleMemberIds` → snapshot = current attendees; explicit list with a non-attendee → rejected; snapshot unchanged after attendee changes; `< 2` / duplicate options, `affirmativeOption` not in options, empty `eligibleMemberIds` → `VALIDATION_ERROR`; rollback injection leaves no vote/eligibility/audit rows

### Implementation for User Story 1

- [X] T018 [P] [US1] Add `createVoteSchema` to `src/modules/votes/schemas/zod.ts` — `question`, `options` (array, `min(2)`, distinct refine), `affirmativeOption`, `deadline` (datetime), `eligibleMemberIds` (uuid array, nullable, `min(1)` when present), plus a cross-field refine that `affirmativeOption ∈ options`; add the inferred request type to `src/modules/votes/types/request.ts`
- [X] T019 [US1] Implement `createVote` in `src/modules/votes/vote.service.ts` — `withTx`: load the meeting (must be `IN_PROGRESS` else `INVALID_STATE_TRANSITION`), resolve the eligible set (null → current `meeting_attendees`; explicit → validate each is an attendee; reject an empty result), insert the `votes` row (`status='OPEN'`, `affirmativeOption`, `outcome`/`resultSummary` null), bulk-insert `vote_eligibility` rows, `emitAudit(tx, 'vote.created')` (depends on T009, T018)
- [X] T020 [US1] Implement the `createVote` handler in `src/modules/votes/vote.controller.ts` (depends on T019)
- [X] T021 [US1] Register `POST /votes/meeting/:meetingId/org/:orgId` in `src/modules/votes/vote.routes.ts` with pre-handlers `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('vote:create')` (depends on T011, T020)

**Checkpoint**: Votes can be created with a frozen eligibility snapshot — MVP is demonstrable.

---

## Phase 4: User Story 2 - Cast a ballot in an open vote (Priority: P1)

**Goal**: A member in a vote's eligible set casts a single confidential ballot; a second attempt, an ineligible caller, or an out-of-options choice is rejected.

**Independent Test**: Create an open vote with two eligible members, cast a ballot as the first (success), cast again as the same member (`DUPLICATE_BALLOT`), attempt a ballot as a member outside the eligible set (`FORBIDDEN`), and cast a ballot with a choice not in the options list (rejected).

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T022 [P] [US2] Integration test `tests/integration/modules/votes/ballot-cast.test.ts` — FR-405/406/407: eligible member casts a ballot (`ballot.submitted` audit, payload carries no choice); second ballot → `DUPLICATE_BALLOT`; ineligible caller → `FORBIDDEN`; choice not in options → `VALIDATION_ERROR`; ballot on a `CLOSED` vote → `VOTE_CLOSED`; no read/list response exposes a per-member choice

### Implementation for User Story 2

- [X] T023 [P] [US2] Add `castBallotSchema` to `src/modules/votes/schemas/zod.ts` — `choice` (non-empty string) — plus the inferred request type in `src/modules/votes/types/request.ts`
- [X] T024 [US2] Implement `castBallot` in `src/modules/votes/vote.service.ts` — `withTx`: load the vote (`status='OPEN'` else `VOTE_CLOSED`), resolve the caller's membership id, verify a `vote_eligibility` row exists (else `FORBIDDEN`), verify `choice ∈ vote.options` (else `VALIDATION_ERROR`), insert the `ballots` row translating an `isUniqueViolation` into `AppError.duplicateBallot()`, `emitAudit(tx, 'ballot.submitted', { data: { voteId } })` — never the choice (depends on T009, T023)
- [X] T025 [US2] Implement the `castBallot` handler in `src/modules/votes/vote.controller.ts` (depends on T024)
- [X] T026 [US2] Register `POST /votes/:voteId/meeting/:meetingId/org/:orgId/ballots` in `src/modules/votes/vote.routes.ts` with `requirePermission('vote:cast_ballot')` (depends on T011, T025)

**Checkpoint**: Eligible members can cast confidential, one-per-member ballots.

---

## Phase 5: User Story 3 - Close a vote, compute its outcome, and block premature meeting completion (Priority: P1)

**Goal**: A member with `vote:close` closes an open vote; the system tallies ballots, checks quorum, and records an immutable outcome. The `IN_PROGRESS → COMPLETED` meeting guard now actively blocks meetings with open votes.

**Independent Test**: Create an open vote, cast enough ballots for quorum with a clear winner (verify outcome), repeat with too few ballots (`QUORUM_NOT_MET`) and a tie (`TIED`); attempt to complete a meeting with an open vote (`MEETING_HAS_OPEN_VOTES`) and again after closing it (success).

> **FR-410 needs no meeting-module code** — `meeting.service.ts` already counts `OPEN` votes on the `IN_PROGRESS → COMPLETED` transition. T028 verifies the guard now actively blocks; no `src/modules/meetings/` file is edited.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T027 [P] [US3] Unit test `tests/unit/modules/votes/outcome.test.ts` — exhaustive `computeOutcome`: below-quorum → `QUORUM_NOT_MET`; quorum met + tie → `TIED`; clear winner on the affirmative option → `PASSED`; clear winner on another option → `FAILED`; zero ballots; zero threshold; the `participation === threshold` boundary (quorum met)
- [X] T028 [P] [US3] Integration test `tests/integration/modules/votes/vote-close.test.ts` — FR-408/409/410: close records outcome + result summary + `closedAt` + `vote.closed` audit; re-close → `CONFLICT`; quorum-not-met / tie / passed / failed cases; completing a meeting with an `OPEN` vote → `MEETING_HAS_OPEN_VOTES`, and succeeds once the vote is `CLOSED`

### Implementation for User Story 3

- [X] T029 [P] [US3] Implement the pure `computeOutcome` in `src/modules/votes/utils/outcome.ts` per `contracts/vote-outcome.md` — no Fastify or DB import; returns `{ outcome, winner }`
- [X] T030 [US3] Implement `closeVote` in `src/modules/votes/vote.service.ts` — `withTx`: load the vote, tally ballots with one `GROUP BY` query, count `vote_eligibility` and ballots, call `computeOutcome` with `Number(organizations.quorum_threshold)`, perform the guarded `UPDATE … SET status='CLOSED', outcome, resultSummary, closedAt WHERE id=? AND status='OPEN'` (zero rows → `CONFLICT`), `emitAudit(tx, 'vote.closed')` carrying the outcome (depends on T009, T029)
- [X] T031 [US3] Implement the `closeVote` handler in `src/modules/votes/vote.controller.ts` (depends on T030)
- [X] T032 [US3] Register `PATCH /votes/:voteId/meeting/:meetingId/org/:orgId/close` in `src/modules/votes/vote.routes.ts` with `requirePermission('vote:close')` (depends on T011, T031)

**Checkpoint**: The full vote lifecycle (create → ballot → close) works and the meeting-completion guard is proven active — the votes track is feature-complete for write paths.

---

## Phase 6: User Story 4 - Create and revise draft minutes for a completed meeting (Priority: P1)

**Goal**: A member with `minutes:create` opens a draft minutes document for a `COMPLETED` meeting; it can be edited and have resolutions (each referencing a closed vote) attached while it is `DRAFT`.

**Independent Test**: Complete a meeting with one closed vote, create its minutes (`DRAFT`), attempt a second create (`CONFLICT`), edit the summary, attach a resolution referencing the closed vote (success), and attempt to create minutes for a non-`COMPLETED` meeting (rejected).

### Tests for User Story 4 ⚠️ (write first, must fail)

- [X] T033 [P] [US4] Integration test `tests/integration/modules/minutes/minutes-create.test.ts` — FR-412/413/414/415: create against a `COMPLETED` meeting (`DRAFT` status, `minutes.created` audit); non-`COMPLETED` → `INVALID_STATE_TRANSITION`; second create → `CONFLICT`; edit summary/notes → `minutes.updated`; attach a resolution referencing a `CLOSED` vote of the same meeting; resolution referencing a non-closed or foreign vote → rejected

### Implementation for User Story 4

- [X] T034 [P] [US4] Add `createMinutesSchema` (`summary?`, `attendanceNotes?`), `editMinutesSchema` (subset of `summary`/`attendanceNotes`, `minProperties: 1`), and `attachResolutionSchema` (`voteId`, `description`) to `src/modules/minutes/schemas/zod.ts` plus inferred request types in `src/modules/minutes/types/request.ts`
- [X] T035 [US4] Implement `createMinutes`, `editMinutes`, and `attachResolution` in `src/modules/minutes/minutes.service.ts` — each in `withTx`: create (meeting `COMPLETED` else `INVALID_STATE_TRANSITION`; `minutes_meeting_id_unique` violation → `CONFLICT`; emit `minutes.created`); edit (`DRAFT` only else `MINUTES_FINALIZED`; emit `minutes.updated`); attachResolution (`DRAFT` only else `MINUTES_FINALIZED`; referenced vote must belong to the meeting and be `CLOSED` else `VALIDATION_ERROR`; insert `minutes_resolutions`; no audit event — research Decision 13) (depends on T010, T034)
- [X] T036 [US4] Implement the `createMinutes`, `editMinutes`, and `attachResolution` handlers in `src/modules/minutes/minutes.controller.ts` (depends on T035)
- [X] T037 [US4] Register `POST /minutes/meeting/:meetingId/org/:orgId` (`minutes:create`), `PATCH /minutes/meeting/:meetingId/org/:orgId` (`minutes:update`), and `POST /minutes/meeting/:meetingId/org/:orgId/resolutions` (`minutes:update`) in `src/modules/minutes/minutes.routes.ts` with the standard pre-handler chain (depends on T012, T036)

**Checkpoint**: Draft minutes can be created, revised, and have resolutions attached.

---

## Phase 7: User Story 5 - Finalize minutes into an immutable record (Priority: P1)

**Goal**: A member with `minutes:finalize` finalizes a draft minutes document, stamping a finalization time and permanently locking the body and resolution set.

**Independent Test**: Create a draft minutes document, finalize it (verify `FINALIZED` status and timestamp), then attempt to edit it and to attach a resolution — verify both are rejected with `MINUTES_FINALIZED`.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [X] T038 [P] [US5] Integration test `tests/integration/modules/minutes/minutes-finalize.test.ts` — FR-416/417: finalize a `DRAFT` (status `FINALIZED`, `finalizedAt` set, `minutes.finalized` audit); re-finalize → `CONFLICT`; editing a `FINALIZED` document → `MINUTES_FINALIZED`; attaching a resolution to a `FINALIZED` document → `MINUTES_FINALIZED`

### Implementation for User Story 5

- [X] T039 [US5] Implement `finalizeMinutes` in `src/modules/minutes/minutes.service.ts` — `withTx`: `DRAFT` only (else `CONFLICT`), set `status='FINALIZED'` and `finalizedAt`, `emitAudit(tx, 'minutes.finalized')` (depends on T010)
- [X] T040 [US5] Implement the `finalizeMinutes` handler in `src/modules/minutes/minutes.controller.ts` (depends on T039)
- [X] T041 [US5] Register `POST /minutes/meeting/:meetingId/org/:orgId/finalize` in `src/modules/minutes/minutes.routes.ts` with `requirePermission('minutes:finalize')` (depends on T012, T040)

**Checkpoint**: Minutes can be finalized into an immutable record.

---

## Phase 8: User Story 6 - Append corrections to finalized minutes (Priority: P2)

**Goal**: A member with `minutes:update` appends a timestamped, append-only correction to a finalized minutes document; the locked body is never altered.

**Independent Test**: Finalize a minutes document, append a correction (recorded with a timestamp), append a second, read the minutes and verify both corrections appear in order while the finalized body is unchanged; attempt a correction on a draft document (rejected).

### Tests for User Story 6 ⚠️ (write first, must fail)

- [X] T042 [P] [US6] Integration test `tests/integration/modules/minutes/minutes-corrections.test.ts` — FR-418: append a correction to a `FINALIZED` document (timestamped, body unchanged, `minutes.correction_added` audit); multiple corrections returned in chronological order; correction on a `DRAFT` document → `INVALID_STATE_TRANSITION`

### Implementation for User Story 6

- [X] T043 [P] [US6] Add `appendCorrectionSchema` (`content`, non-empty string) to `src/modules/minutes/schemas/zod.ts` plus the inferred request type in `src/modules/minutes/types/request.ts`
- [X] T044 [US6] Implement `appendCorrection` in `src/modules/minutes/minutes.service.ts` — `withTx`: `FINALIZED` only (else `INVALID_STATE_TRANSITION`), insert a `minutes_corrections` row, `emitAudit(tx, 'minutes.correction_added')` (depends on T010, T043)
- [X] T045 [US6] Implement the `appendCorrection` handler in `src/modules/minutes/minutes.controller.ts` (depends on T044)
- [X] T046 [US6] Register `POST /minutes/meeting/:meetingId/org/:orgId/corrections` in `src/modules/minutes/minutes.routes.ts` with `requirePermission('minutes:update')` (depends on T012, T045)

**Checkpoint**: Corrections can be appended to finalized minutes without unlocking them.

---

## Phase 9: User Story 7 - View and export votes and minutes (Priority: P2)

**Goal**: Members with `vote:read` browse a meeting's votes and view one vote's aggregate results; any org member reads a meeting's minutes; a member with `minutes:read` exports the minutes as a PDF.

**Independent Test**: Create and close a vote, create and finalize minutes with a resolution and a correction, then list the meeting's votes, read a single vote, read the minutes, and export the minutes — verifying each response is complete, no per-member ballot data appears, and the export PDF contains the meeting details, resolutions, and corrections.

### Tests for User Story 7 ⚠️ (write first, must fail)

- [X] T047 [P] [US7] Integration test `tests/integration/modules/votes/vote-read.test.ts` — FR-407/411: list votes (cursor-paginated, each with its aggregate `resultSummary`) and read a single vote; assert no response exposes a per-member ballot choice
- [X] T048 [P] [US7] Integration test `tests/integration/modules/minutes/minutes-read-export.test.ts` — FR-419/420: read minutes returns body + resolutions + chronological corrections, readable by an org member holding no `minutes:*` key; export returns `Content-Type: application/pdf` with a `Content-Disposition` attachment header and a valid `%PDF` document; `minutes.exported` audit; read/export with no minutes → `NOT_FOUND`

### Implementation for User Story 7

- [X] T049 [P] [US7] Add `listVotesSchema` (query: `status?`, `cursor?`, `limit?`) and `getVoteSchema` to `src/modules/votes/schemas/zod.ts` plus inferred types in `src/modules/votes/types/request.ts`
- [X] T050 [US7] Implement `listVotes` (meeting-scoped, keyset pagination via `applyKeysetWhere`, default 20 / max 100) and `getVote` (single vote, aggregate `resultSummary` only) in `src/modules/votes/vote.service.ts` (depends on T009, T049)
- [X] T051 [US7] Implement the `listVotes` and `getVote` handlers in `src/modules/votes/vote.controller.ts` (depends on T050)
- [X] T052 [US7] Register `GET /votes/meeting/:meetingId/org/:orgId` and `GET /votes/:voteId/meeting/:meetingId/org/:orgId` in `src/modules/votes/vote.routes.ts` with `requirePermission('vote:read')` (depends on T011, T051)
- [X] T053 [P] [US7] Implement `renderMinutesPdf` in `src/modules/minutes/utils/pdf.ts` using `pdfkit` — a structured, human-readable document with the meeting details, minutes body, resolutions, and corrections; no Fastify or DB import
- [X] T054 [US7] Implement `readMinutes` (assembles minutes + resolutions + chronological corrections) and `exportMinutes` (loads the meeting + minutes + resolutions + corrections, renders the PDF, `emitAudit(tx, 'minutes.exported')`) in `src/modules/minutes/minutes.service.ts` (depends on T010, T053)
- [X] T055 [US7] Implement the `readMinutes` and `exportMinutes` handlers in `src/modules/minutes/minutes.controller.ts` — `exportMinutes` bypasses the success envelope, replying with the PDF and `content-type: application/pdf` + `content-disposition` headers (depends on T054)
- [X] T056 [US7] Register `GET /minutes/meeting/:meetingId/org/:orgId` (pre-handler `requireMembership` — identity only) and `GET /minutes/meeting/:meetingId/org/:orgId/export` (`requirePermission('minutes:read')`) in `src/modules/minutes/minutes.routes.ts` (depends on T012, T055)

**Checkpoint**: All seven user stories are independently functional — the full governance cycle is demonstrable.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, quality gates, and end-to-end validation.

- [ ] T057 [P] Regenerate the OpenAPI document (`pnpm gen:openapi`) and confirm all 12 vote and minutes endpoints appear in `docs/openapi.json`
- [ ] T058 [P] Run the linter and formatter (`pnpm lint`, `pnpm format:check`) — zero warnings (Constitution I)
- [ ] T059 Run the full vote and minutes test suites (`pnpm test tests/unit/modules/votes tests/integration/modules/votes tests/integration/modules/minutes`) and confirm coverage ≥ 80% (Constitution II)
- [ ] T060 Execute `specs/005-voting-minutes/quickstart.md` end-to-end against a running server and confirm all 8 audit events

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **User Stories (Phases 3–9)**: each depends on Foundational completion.
- **Polish (Phase 10)**: depends on all user stories being complete.

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. Pure vote-creation path.
- **US2 (P1)**: depends only on Foundational. Its tests reuse the create path.
- **US3 (P1)**: depends only on Foundational. Its tests reuse create + ballot
  paths. **FR-410 adds no meeting-module code** — the open-votes guard already
  exists; T028 only verifies it.
- **US4 (P1)**: depends only on Foundational. Needs a `CLOSED` vote, which the
  minutes test helper (T016) provides by direct insert — so US4 does **not**
  depend on the votes module code.
- **US5 (P1)**: depends only on Foundational. Its tests reuse the minutes create
  path.
- **US6 (P2)**: depends only on Foundational. Its tests reuse create + finalize.
- **US7 (P2)**: depends only on Foundational. Two independent sub-tracks — votes
  read (T047, T049–T052) and minutes read/export (T048, T053–T056); its tests
  reuse the earlier write paths.

### Two-module independence

The `votes` track (US1–US3) and the `minutes` track (US4–US6) share **no source
files** and can be built fully in parallel by two developers. US7 appends to
both modules but its two sub-tracks are likewise independent.

### Shared-file note (affects parallelism within a module)

Within the votes module, US1–US3 and the votes half of US7 each append to the
same four files — `vote.service.ts`, `vote.controller.ts`, `vote.routes.ts`,
`schemas/zod.ts`. Within the minutes module, US4–US6 and the minutes half of US7
likewise share `minutes.service.ts`, `minutes.controller.ts`,
`minutes.routes.ts`, `schemas/zod.ts`. Stories are _logically_ independent and
independently testable, but their service/controller/route/schema tasks
**serialize on these files**. Treat each module's stories as sequential by
priority unless one developer takes a whole story end-to-end.

### Within Each User Story

- Tests are written first and must fail before implementation (TDD — Constitution II).
- Schema → service → controller → route (each depends on the previous).
- `[P]` tasks within a story touch distinct files (e.g. the test file, the
  schema file, and — in US3/US7 — the pure `outcome.ts` / `pdf.ts` modules).

---

## Parallel Example: Foundational Phase

```bash
# After T005/T006/T007, the independent foundational files proceed together:
Task: "Create src/shared/http/pre-handlers/require-membership.ts"          # T008
Task: "Create votes controller + service shells"                           # T009
Task: "Create minutes controller + service shells"                         # T010
Task: "Create votes routes shell src/modules/votes/vote.routes.ts"          # T011
Task: "Create minutes routes shell src/modules/minutes/minutes.routes.ts"   # T012
Task: "Add truncateVoteTables/truncateMinutesTables to helpers/db.ts"       # T014
Task: "Create tests/integration/modules/votes/helpers.ts"                   # T015
Task: "Create tests/integration/modules/minutes/helpers.ts"                 # T016
# T013 (app.ts registration) then runs once T011 + T012 are done.
```

## Parallel Example: User Story 3

```bash
# Tests for US3 (distinct files) can be written together:
Task: "Unit test tests/unit/modules/votes/outcome.test.ts"                  # T027
Task: "Integration test tests/integration/modules/votes/vote-close.test.ts" # T028

# The pure outcome util is a distinct file — parallel with the test work:
Task: "Implement src/modules/votes/utils/outcome.ts"                        # T029
# closeVote service → controller → route then run sequentially (T030→T032).
```

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) → Phase 2 (Foundational).
2. Phase 3 (US1) → **stop and validate**: a vote can be created with a frozen
   eligibility snapshot.
3. US1 is the smallest shippable increment. A genuinely useful release of the
   voting half needs all three P1 vote stories (US1–US3).

### Incremental Delivery

1. Setup + Foundational → both modules wired in.
2. US1 → create votes (MVP).
3. US2 → cast ballots.
4. US3 → close votes + active meeting-completion guard → votes track complete.
5. US4 → draft minutes + resolutions.
6. US5 → finalize minutes → minutes core complete.
7. US6 → corrections (P2).
8. US7 → view & export (P2) → full governance cycle demonstrable.

### Parallel Team Strategy

With two developers, after Foundational:

- Developer A: the votes track — US1 → US2 → US3, then the votes half of US7.
- Developer B: the minutes track — US4 → US5 → US6, then the minutes half of US7.

The tracks share no files and integrate only through the database.

### Suggested MVP Scope

**US1 only** for the first checkpoint; **US1 + US2 + US3** (the P1 vote stories)
for the first useful voting release, and **US4 + US5** (the P1 minutes stories)
for the first useful minutes release.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[Story]` label maps each task to a user story for traceability.
- Verify every test fails before implementing against it (TDD — Constitution II).
- One additive migration only — `votes.affirmative_option` (T005); the other
  six tables already exist from Phase 0.
- `vote.created` / `ballot.submitted` / `vote.closed` / `minutes.created` /
  `minutes.updated` / `minutes.finalized` / `minutes.correction_added` /
  `minutes.exported` — all 8 audit events emit inside the originating `withTx`
  transaction. Attaching a resolution emits no event (research Decision 13).
- Commit after each task or logical group; stop at any checkpoint to validate.
