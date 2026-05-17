# Feature Specification: Voting & Minutes

**Feature Branch**: `005-voting-minutes`
**Created**: 2026-05-17
**Status**: Draft
**Input**: User description: "@docs/IMPLEMENTATION-PLAN.md phase-4 voting and minutes"

## Clarifications

### Session 2026-05-17

- Q: When a vote is closed, quorum is met, and one option has a clear majority,
  how is a `PASSED` outcome distinguished from a `FAILED` one? → A: The vote
  creator designates one of the options as the affirmative ("passing") choice at
  creation time; if that option is the clear winner the outcome is `PASSED`, and
  if any other option wins it is `FAILED`.
- Q: Who may read a meeting's minutes, and who may export them? → A: Reading
  minutes requires only identity — any member of the organization may read
  them. Exporting minutes requires the `minutes:read` permission.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Create a formal vote with an immutable eligibility snapshot (Priority: P1)

A member with vote-creation permission opens a formal vote inside a meeting that
is currently in progress. They state the question, supply the list of choices,
set a deadline, and define who is eligible to vote — either by naming specific
meeting attendees or by leaving it open to every current attendee. At the moment
the vote is created the eligible voter set is frozen: a snapshot is taken that
never changes again, even if attendees are added or removed afterward.

**Why this priority**: The vote is the unit of formal decision-making and the
eligibility snapshot is the integrity foundation for every later step — ballots,
quorum, and outcome all read from it. Nothing else in the voting flow can be
exercised until a vote with a fixed eligible set exists.

**Independent Test**: Authenticate as a member with `vote:create` in an org with
onboarding `COMPLETE`, drive a meeting to `IN_PROGRESS` with two attendees,
create a vote with `eligibleMemberIds` left open, then add a third attendee to
the meeting — fetch the vote and verify the eligible set still contains exactly
the original two members.

**Acceptance Scenarios**:

1. **Given** a meeting in `IN_PROGRESS` with at least one attendee, **When** a
   member with `vote:create` creates a vote, **Then** the vote is created with
   status `OPEN`, the eligibility snapshot rows are inserted, and a
   `vote.created` audit entry is written — all in one transaction.
2. **Given** a vote-creation request against a meeting that is not
   `IN_PROGRESS`, **When** it is processed, **Then** the request is rejected
   with `INVALID_STATE_TRANSITION` and no vote is created.
3. **Given** a vote-creation request with `eligibleMemberIds` omitted or null,
   **When** it is processed, **Then** the eligible set is the meeting's current
   attendee list captured at that instant.
4. **Given** a vote-creation request with an explicit `eligibleMemberIds` list,
   **When** any identifier in it is not a current attendee of the meeting,
   **Then** the whole request is rejected and no vote and no eligibility rows
   are created.
5. **Given** a created vote, **When** attendees are later added to or removed
   from the meeting, **Then** the vote's eligibility snapshot is unchanged.
6. **Given** a vote-creation request, **When** the vote row or any eligibility
   row fails to persist, **Then** the whole transaction rolls back — no vote, no
   eligibility rows, and no audit entry remain.

---

### User Story 2 - Cast a ballot in an open vote (Priority: P1)

A member who is in a vote's eligible set casts a single ballot, choosing one of
the vote's stated options. Each eligible member may vote exactly once; a second
attempt is rejected. Members who are not in the eligible set cannot cast a
ballot at all. Individual ballot choices are confidential — they are never
exposed in any read response.

**Why this priority**: Ballots are the input to every outcome. Without ballot
casting there is nothing for the close step to count, and the one-ballot-per-
member and confidentiality rules are core governance guarantees.

**Independent Test**: Create an open vote with two eligible members, cast a
ballot as the first member (verify success), cast again as the same member
(verify `DUPLICATE_BALLOT`), attempt a ballot as a member outside the eligible
set (verify `FORBIDDEN`), and cast a ballot with a choice not in the options
list (verify rejection).

**Acceptance Scenarios**:

1. **Given** an `OPEN` vote and a caller whose membership is in the eligibility
   snapshot, **When** they submit a ballot with a choice present in the vote's
   options, **Then** the ballot is recorded and a `ballot.submitted` audit entry
   is written in the same transaction.
2. **Given** an eligible member who has already cast a ballot, **When** they
   submit a second ballot for the same vote, **Then** the request is rejected
   with `DUPLICATE_BALLOT` and the first ballot is unchanged.
3. **Given** a caller whose membership is not in the vote's eligibility
   snapshot, **When** they submit a ballot, **Then** the request is rejected
   with `FORBIDDEN` and no ballot is recorded.
4. **Given** a ballot submission whose choice is not one of the vote's options,
   **When** it is processed, **Then** the request is rejected as invalid input
   and no ballot is recorded.
5. **Given** a vote that is `CLOSED`, **When** any eligible member submits a
   ballot, **Then** the request is rejected with `VOTE_CLOSED`.
6. **Given** any number of recorded ballots, **When** a vote is read or listed,
   **Then** the response exposes only aggregate counts — no response ever
   reveals which member chose which option.

---

### User Story 3 - Close a vote, compute its outcome, and block premature meeting completion (Priority: P1)

A member with vote-closing permission closes an open vote. The system tallies
the ballots, checks whether quorum was reached against the organization's
threshold, and records a final outcome that can never change. While any vote in
a meeting is still open, the meeting cannot be moved to `COMPLETED` — the
open-votes guard, wired but dormant in the meetings feature, now actively
enforces this.

**Why this priority**: Closing is what turns ballots into a governance
decision. The quorum and outcome rules are the heart of the module, and
activating the meeting-completion guard closes the last gap left open by the
meetings feature.

**Independent Test**: Create an open vote, cast enough ballots to satisfy
quorum with a clear winner (verify outcome), repeat with too few ballots (verify
`QUORUM_NOT_MET`), repeat with a tie (verify `TIED`); separately, attempt to
complete a meeting that still has an open vote (verify `MEETING_HAS_OPEN_VOTES`)
and again after closing it (verify success).

**Acceptance Scenarios**:

1. **Given** an `OPEN` vote, **When** a member with `vote:close` closes it,
   **Then** the vote becomes `CLOSED`, its outcome and result summary and
   closing time are recorded, and a `vote.closed` audit entry carrying the
   outcome is written — all in one transaction.
2. **Given** a vote that is already `CLOSED`, **When** a close is requested
   again, **Then** the request is rejected with `CONFLICT` and the recorded
   outcome is unchanged.
3. **Given** a vote being closed where the count of cast ballots divided by the
   count of eligible members is below the organization's quorum threshold,
   **When** the outcome is computed, **Then** the outcome is `QUORUM_NOT_MET`.
4. **Given** a vote being closed where quorum is met and one option has strictly
   more ballots than every other, **When** the outcome is computed, **Then** the
   outcome is `PASSED` if the winning option is the vote's designated affirmative
   option and `FAILED` otherwise, and the winning option is recorded in the
   result summary.
5. **Given** a vote being closed where quorum is met but the two highest options
   are tied, **When** the outcome is computed, **Then** the outcome is `TIED`.
6. **Given** a meeting in `IN_PROGRESS` that has at least one `OPEN` vote,
   **When** a transition to `COMPLETED` is requested, **Then** it is rejected
   with `MEETING_HAS_OPEN_VOTES` and the meeting status is unchanged.
7. **Given** a meeting in `IN_PROGRESS` whose every vote is `CLOSED` (or which
   has no votes), **When** a transition to `COMPLETED` is requested, **Then** it
   succeeds.

---

### User Story 4 - Create and revise draft minutes for a completed meeting (Priority: P1)

A member with minutes-creation permission opens a minutes document for a meeting
that has completed. The document starts as a draft that can be edited freely —
its summary and attendance notes revised, and resolutions attached that each
reference a closed vote from that meeting. Only one minutes document may exist
per meeting.

**Why this priority**: Minutes are the official record of what a meeting
decided. A meeting without minutes leaves the governance cycle incomplete, and
the draft stage is where the record is assembled before it is locked.

**Independent Test**: Complete a meeting that has one closed vote, create its
minutes (verify draft status), attempt to create a second minutes document for
the same meeting (verify `CONFLICT`), edit the summary, attach a resolution
referencing the closed vote (verify success), and attempt to create minutes for
a meeting that is not `COMPLETED` (verify rejection).

**Acceptance Scenarios**:

1. **Given** a meeting in `COMPLETED`, **When** a member with `minutes:create`
   creates its minutes, **Then** a minutes document is created with status
   `DRAFT` and a `minutes.created` audit entry is written in the same
   transaction.
2. **Given** a meeting that is not `COMPLETED`, **When** minutes creation is
   requested, **Then** the request is rejected with `INVALID_STATE_TRANSITION`.
3. **Given** a meeting that already has a minutes document, **When** a second
   creation is requested, **Then** the request is rejected with `CONFLICT`.
4. **Given** a minutes document in `DRAFT`, **When** a member with
   `minutes:update` edits its summary or attendance notes, **Then** the changes
   are saved and a `minutes.updated` audit entry is written.
5. **Given** a minutes document in `DRAFT`, **When** a member with
   `minutes:update` attaches a resolution that references a `CLOSED` vote
   belonging to the same meeting, **Then** the resolution is recorded against
   the minutes.
6. **Given** a resolution-attach request that references a vote that is not
   `CLOSED`, or a vote that does not belong to this meeting, **When** it is
   processed, **Then** the request is rejected and no resolution is recorded.

---

### User Story 5 - Finalize minutes into an immutable record (Priority: P1)

A member with minutes-finalize permission finalizes a draft minutes document.
Finalizing stamps it with a finalization time and permanently locks it — no edit
to its summary, attendance notes, or resolutions is ever accepted again.

**Why this priority**: Immutable finalized records are a non-negotiable platform
principle. The finalize step is the boundary that converts an editable draft
into a tamper-evident official record.

**Independent Test**: Create a draft minutes document, finalize it (verify
finalized status and timestamp), then attempt to edit it and to attach a
resolution (verify both rejected with `MINUTES_FINALIZED`).

**Acceptance Scenarios**:

1. **Given** a minutes document in `DRAFT`, **When** a member with
   `minutes:finalize` finalizes it, **Then** its status becomes `FINALIZED`, a
   finalization timestamp is recorded, and a `minutes.finalized` audit entry is
   written in the same transaction.
2. **Given** a minutes document that is already `FINALIZED`, **When** finalize
   is requested again, **Then** the request is rejected and the document is
   unchanged.
3. **Given** a `FINALIZED` minutes document, **When** an edit of its summary or
   attendance notes is attempted, **Then** the request is rejected with
   `MINUTES_FINALIZED` and nothing is changed.
4. **Given** a `FINALIZED` minutes document, **When** attaching a resolution is
   attempted, **Then** the request is rejected with `MINUTES_FINALIZED`.

---

### User Story 6 - Append corrections to finalized minutes (Priority: P2)

After minutes are finalized, errors discovered later cannot be fixed by editing
the locked document. Instead, a member with the appropriate permission appends a
correction — a timestamped, append-only notice that sits alongside the minutes.
The original finalized document is never altered.

**Why this priority**: Corrections are how the immutable-records principle stays
practical: the record stays locked, but the organization can still acknowledge
and document a mistake. It depends on finalized minutes existing (User Story 5).

**Independent Test**: Finalize a minutes document, append a correction (verify
it is recorded with a timestamp), append a second correction, read the minutes
and verify both corrections appear in order while the finalized body is
unchanged; attempt a correction on a draft minutes document (verify rejection).

**Acceptance Scenarios**:

1. **Given** a `FINALIZED` minutes document, **When** a permitted member appends
   a correction, **Then** the correction is recorded with a timestamp, the
   finalized document body is unchanged, and a `minutes.correction_added` audit
   entry is written in the same transaction.
2. **Given** a minutes document still in `DRAFT`, **When** a correction is
   appended, **Then** the request is rejected — corrections apply only to
   finalized minutes.
3. **Given** a finalized minutes document with one or more corrections, **When**
   the minutes are read, **Then** all corrections are returned in chronological
   order alongside the unchanged finalized body.

---

### User Story 7 - View and export votes and minutes (Priority: P2)

Members with the relevant read permission browse the votes attached to a
meeting and view a single vote's aggregate results, and they read a meeting's
minutes together with its resolutions and corrections. A member with export
permission produces a structured, human-readable minutes document suitable for
compliance archiving.

**Why this priority**: Visibility and export complete the governance cycle by
making decisions consultable and archivable, but they carry no state-integrity
risk and depend on the write paths (User Stories 1–6) already existing.

**Independent Test**: Create and close a vote, create and finalize minutes with
a resolution and a correction, then list the meeting's votes, read a single
vote, read the minutes, and export the minutes — verifying each response is
complete and the export contains the meeting details, resolutions, and
corrections.

**Acceptance Scenarios**:

1. **Given** a meeting with one or more votes, **When** a member with
   `vote:read` lists them, **Then** each vote is returned with its aggregate
   result summary and no per-member ballot data.
2. **Given** a meeting with finalized minutes, **When** any member of the
   organization reads them, **Then** the response includes the minutes body,
   the attached resolutions, and the appended corrections.
3. **Given** a meeting with minutes, **When** a member with export permission
   exports them, **Then** a structured, human-readable document is produced
   containing the meeting details, the minutes body, the resolutions, and the
   corrections, and a `minutes.exported` audit entry is written.

---

### Edge Cases

- A vote created with `eligibleMemberIds` set to an empty list — rejected; an
  eligible set with zero members would make quorum undefined, so the eligible
  set must contain at least one member.
- A vote created with fewer than two options, or with duplicate option values —
  rejected; a vote must offer at least two distinct choices.
- Closing a vote on which zero ballots were cast — quorum is `0 / total_eligible`,
  which is below any positive threshold, so the outcome is `QUORUM_NOT_MET`.
- A vote whose `deadline` has already passed but whose status is still `OPEN` —
  ballots are still accepted; the deadline is advisory and does not auto-close a
  vote in this feature (closing is always explicit).
- Two callers concurrently closing the same vote — exactly one close is applied;
  the other observes the `CLOSED` status and is rejected with `CONFLICT`.
- Two eligible members concurrently casting their first ballot — both succeed;
  the one-ballot-per-member rule only blocks a second ballot from the same
  member.
- A meeting moved to `CANCELLED` while it has open votes — cancellation is not
  guarded by the open-votes rule (only completion is); the open-votes guard
  applies solely to the `IN_PROGRESS → COMPLETED` transition.
- Attempting to create a vote against a meeting in `DRAFT`, `SCHEDULED`,
  `COMPLETED`, or `CANCELLED` — rejected with `INVALID_STATE_TRANSITION`; votes
  exist only on `IN_PROGRESS` meetings.
- Attaching the same closed vote as a resolution twice to one minutes document —
  treated as two distinct resolution entries unless an explicit uniqueness rule
  is decided during planning (noted in Assumptions).
- Reading or exporting minutes for a meeting that has no minutes document —
  returns a `NOT_FOUND`-style response; export requires an existing document.
- A quorum threshold of zero on the organization — any vote with at least the
  minimal participation meets quorum; the threshold comparison is
  `total_cast / total_eligible >= threshold`.

## Requirements _(mandatory)_

### Functional Requirements

#### Voting

- **FR-401**: System MUST allow a member holding `vote:create` to create a vote
  attached to a meeting only while that meeting is `IN_PROGRESS`. A creation
  attempt against a meeting in any other status MUST be rejected with
  `INVALID_STATE_TRANSITION`.

- **FR-402**: A vote MUST carry a question, a list of at least two distinct
  options, a designated affirmative option (which MUST be one of those options),
  a deadline, a status (`OPEN` / `CLOSED`), an outcome, and a result summary
  holding aggregate counts. A vote is created with status `OPEN`. A creation
  request whose designated affirmative option is not one of the supplied options
  MUST be rejected.

- **FR-403**: At vote creation the system MUST record an immutable eligibility
  snapshot. When `eligibleMemberIds` is omitted or null, the eligible set is the
  meeting's current attendees captured at creation time. When an explicit list
  is supplied, every identifier MUST be a current attendee of the meeting; if
  any is not, the whole request MUST be rejected. The eligible set MUST contain
  at least one member. Once written, eligibility rows MUST NOT be altered or
  added to — later attendee changes MUST NOT affect a vote's eligible set.

- **FR-404**: Vote creation MUST be atomic: inserting the vote, inserting all
  eligibility rows, and emitting the `vote.created` audit entry MUST occur in a
  single database transaction; if any step fails, the entire transaction MUST
  roll back with no partial state.

- **FR-405**: System MUST allow a member holding `vote:cast_ballot` to submit a
  ballot to a vote. Submission MUST be rejected unless the vote status is `OPEN`
  (else `VOTE_CLOSED`), the caller's membership is present in the vote's
  eligibility snapshot (else `FORBIDDEN`), and the chosen value is one of the
  vote's options (else an invalid-input rejection).

- **FR-406**: Each eligible member MUST be able to cast at most one ballot per
  vote. A second ballot from the same member for the same vote MUST be rejected
  with `DUPLICATE_BALLOT`. Recording a ballot MUST emit a `ballot.submitted`
  audit entry in the same transaction as the ballot write.

- **FR-407**: Per-member ballot choices MUST be confidential. No read, list, or
  export response may reveal which member cast which choice; only aggregate
  counts are ever exposed.

- **FR-408**: System MUST allow a member holding `vote:close` to close an `OPEN`
  vote. Closing an already-`CLOSED` vote MUST be rejected with `CONFLICT`.
  Closing MUST atomically update the vote status to `CLOSED`, record the
  outcome, result summary, and closing time, and emit a `vote.closed` audit
  entry carrying the outcome.

- **FR-409**: On close, the system MUST compute the outcome as follows:
  count ballots per option; let `total_eligible` be the count of eligibility
  rows and `total_cast` the count of ballots. If
  `total_cast / total_eligible` is below the organization's quorum threshold,
  the outcome is `QUORUM_NOT_MET`. Otherwise, if the two highest option counts
  are equal, the outcome is `TIED`; if exactly one option has the strictly
  highest count, the outcome is `PASSED` when that winning option is the vote's
  designated affirmative option, and `FAILED` when the winning option is any
  other option.

- **FR-410**: The `IN_PROGRESS → COMPLETED` meeting transition guard MUST now be
  actively enforced: if any vote attached to the meeting has status `OPEN`, the
  transition MUST be rejected with `MEETING_HAS_OPEN_VOTES`. This activates the
  guard wired but dormant in the meetings feature.

- **FR-411**: System MUST provide vote list and vote detail views readable by
  members holding `vote:read`, scoped to a meeting, returning each vote's
  question, options, status, outcome, and aggregate result summary.

#### Minutes

- **FR-412**: System MUST allow a member holding `minutes:create` to create a
  minutes document for a meeting only while that meeting is `COMPLETED`; a
  creation attempt against a meeting in any other status MUST be rejected with
  `INVALID_STATE_TRANSITION`. At most one minutes document may exist per
  meeting; a second creation attempt MUST be rejected with `CONFLICT`. A minutes
  document is created with status `DRAFT` and a `minutes.created` audit entry is
  written in the same transaction.

- **FR-413**: A minutes document MUST carry a status (`DRAFT` / `FINALIZED`), an
  optional summary, optional attendance notes, and a finalization timestamp set
  only when finalized. It is always scoped to exactly one meeting.

- **FR-414**: System MUST allow a member holding `minutes:update` to edit a
  minutes document's summary and attendance notes only while it is `DRAFT`. An
  edit attempted against a `FINALIZED` document MUST be rejected with
  `MINUTES_FINALIZED`. A successful edit MUST emit a `minutes.updated` audit
  entry.

- **FR-415**: System MUST allow a member holding `minutes:update` to attach a
  resolution to a `DRAFT` minutes document. A resolution MUST reference a vote
  that belongs to the same meeting and has status `CLOSED`, and MUST carry a
  description. A resolution referencing a non-closed vote, or a vote from a
  different meeting, MUST be rejected. Attaching a resolution to a `FINALIZED`
  document MUST be rejected with `MINUTES_FINALIZED`.

- **FR-416**: System MUST allow a member holding `minutes:finalize` to finalize
  a `DRAFT` minutes document. Finalizing MUST set the status to `FINALIZED`,
  record the finalization timestamp, and emit a `minutes.finalized` audit entry
  in the same transaction. Finalizing a document that is not `DRAFT` MUST be
  rejected.

- **FR-417**: Finalized minutes MUST be immutable. Their summary, attendance
  notes, and resolution set MUST NOT be changeable after finalization. The only
  permitted post-finalization addition is an append-only correction.

- **FR-418**: System MUST allow a member holding `minutes:update` to append a
  correction to a `FINALIZED` minutes document. A correction MUST be
  timestamped and append-only; it MUST NOT modify the finalized document body.
  Appending a correction MUST emit a `minutes.correction_added` audit entry in
  the same transaction. A correction attempted against a `DRAFT` document MUST
  be rejected.

- **FR-419**: System MUST provide a minutes read view that returns the minutes
  body together with its attached resolutions and its appended corrections (in
  chronological order). Reading minutes requires only identity — any member of
  the meeting's organization may read its minutes; no permission key is
  required.

- **FR-420**: System MUST provide a minutes export that produces a structured,
  human-readable document containing the meeting details, the minutes body, the
  resolutions, and the corrections, suitable for compliance archiving. Export
  MUST emit a `minutes.exported` audit entry. Export requires the caller to hold
  `minutes:read`.

#### Cross-cutting

- **FR-421**: Permission requirements MUST be enforced per operation: vote
  creation requires `vote:create`; vote list and detail require `vote:read`;
  ballot submission requires `vote:cast_ballot`; vote closing requires
  `vote:close`. Minutes creation requires `minutes:create`; editing, attaching
  resolutions, and appending corrections require `minutes:update`; finalization
  requires `minutes:finalize`; exporting requires `minutes:read`. Reading
  minutes requires only identity — any member of the organization may read
  them, with no permission key. Permissions MUST be resolved per-request, and
  the org Owner bypass applies as in prior phases.

- **FR-422**: All voting and minutes routes MUST be reachable only when the
  organization's onboarding step is `COMPLETE`; requests against an org still in
  onboarding MUST be blocked, consistent with the server-enforced onboarding
  principle.

- **FR-423**: System MUST emit audit log entries for all 8 events:
  `vote.created`, `ballot.submitted`, `vote.closed`, `minutes.created`,
  `minutes.updated`, `minutes.finalized`, `minutes.correction_added`, and
  `minutes.exported`. Each entry MUST be written inside the same transaction as
  its originating write using the shared audit emitter; no audit entry may
  outlive a rolled-back transaction.

- **FR-424**: Votes, ballots, and minutes MUST NOT be hard-deleted. There is no
  delete operation for any of these records; a vote is concluded by closing it
  and a minutes record is concluded by finalizing it.

### Key Entities

- **Vote**: A formal decision attached to one `IN_PROGRESS` meeting. Holds a
  question, a list of at least two distinct options, a designated affirmative
  option drawn from that list, a deadline, a status (`OPEN` / `CLOSED`), an
  outcome (`QUORUM_NOT_MET` / `TIED` / `PASSED` / `FAILED`), a result summary of
  aggregate counts, and a closing time. Owns its eligibility snapshot and its
  ballots.

- **Vote Eligibility**: An immutable, insert-only snapshot of the organization
  memberships entitled to vote on a given vote, captured at vote-creation time.
  It is the denominator for the quorum calculation and the gate for ballot
  submission.

- **Ballot**: One member's single confidential choice on a vote. At most one
  ballot exists per member per vote. Ballot choices are aggregated for results
  and never individually exposed.

- **Minutes**: The official record of a `COMPLETED` meeting. Holds a status
  (`DRAFT` / `FINALIZED`), an optional summary and attendance notes, and a
  finalization timestamp. Exactly one minutes document exists per meeting. Owns
  its resolutions and corrections.

- **Minutes Resolution**: An entry on a draft minutes document that references a
  `CLOSED` vote from the same meeting together with a description, recording a
  formal decision the meeting reached.

- **Minutes Correction**: A timestamped, append-only notice attached to a
  finalized minutes document. Corrections acknowledge errors without unlocking
  or altering the immutable finalized body.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-401**: 100% of vote-creation attempts against a meeting that is not
  `IN_PROGRESS` are rejected with `INVALID_STATE_TRANSITION`, and no vote is
  created.

- **SC-402**: A vote's eligibility snapshot is verifiably unchanged after the
  meeting's attendee set is modified — 100% of snapshot-immutability test cases
  show the original eligible set intact.

- **SC-403**: 100% of ballot submissions by members outside the eligible set are
  rejected, 100% of second-ballot attempts by the same member are rejected with
  `DUPLICATE_BALLOT`, and 100% of ballots with an out-of-options choice are
  rejected.

- **SC-404**: No read, list, or export response in any test scenario exposes an
  individual member's ballot choice; only aggregate counts appear.

- **SC-405**: Outcome computation is correct in 100% of close scenarios —
  quorum-not-met, decided clear winner, and tie cases each produce the expected
  outcome.

- **SC-406**: 100% of attempts to complete a meeting that still has an `OPEN`
  vote are rejected with `MEETING_HAS_OPEN_VOTES`; completion succeeds once all
  its votes are `CLOSED`.

- **SC-407**: 100% of attempts to create a second minutes document for a meeting
  are rejected with `CONFLICT`, and 100% of attempts to create minutes for a
  meeting that is not `COMPLETED` are rejected.

- **SC-408**: 100% of edit, resolution-attach, and correction attempts that
  violate the minutes lifecycle (editing a finalized document, attaching to a
  finalized document, correcting a draft) are rejected with the appropriate
  state error; the finalized body is never altered by any operation.

- **SC-409**: All 8 voting-and-minutes audit events are present in the log after
  exercising each flow end-to-end, and each was written in the same transaction
  as its originating write (verified by rollback injection).

- **SC-410**: All voting and minutes endpoints respond within 200 ms at p95
  against a database holding at least 1,000 meetings with associated votes and
  minutes, matching the platform-wide latency budget.

## Assumptions

- The full schema (including `votes`, `vote_eligibility`, `ballots`, `minutes`,
  `minutes_resolutions`, and `minutes_corrections`) was delivered in Phase 0 and
  is available without modification. This feature introduces no new tables and
  alters no columns.
- The identity pre-handler (Phase 1), the permission guard and audit emitter
  (Phase 0), the onboarding-enforcement pre-handler (Phase 2), and the meeting
  status state machine including the dormant open-votes guard (Phase 3) are
  available and are reused without modification.
- This feature uses the implemented permission set in
  `src/shared/permissions/set.ts` — `VOTE: vote:create, vote:read, vote:open,
  vote:close, vote:cast_ballot` and `MINUTES: minutes:create, minutes:read,
  minutes:update, minutes:finalize`. The Phase 4 prose in
  `docs/IMPLEMENTATION-PLAN.md` cites different names (`vote:view_results`,
  `vote:submit`, `minutes:edit`, `minutes:export`); this spec deliberately uses
  the implemented keys. Operations map as: create vote → `vote:create`; list and
  detail → `vote:read`; cast ballot → `vote:cast_ballot`; close → `vote:close`;
  create minutes → `minutes:create`; edit, attach resolution, append correction
  → `minutes:update`; finalize → `minutes:finalize`; export → `minutes:read`;
  read minutes → identity only (any org member, no permission key, per the plan
  prose). `vote:open` is intentionally unused — a vote is created
  already `OPEN`, so there is no separate open operation. Reconciling the plan
  prose is a separate documentation edit, outside this feature's scope.
- The vote `deadline` is advisory in this feature. Votes are closed only by an
  explicit close request; there is no background job that auto-closes a vote
  when its deadline passes. Ballots remain acceptable on an `OPEN` vote even
  after its deadline.
- The organization's quorum threshold is read from the `organizations` record
  established in Phase 2; this feature does not introduce a way to change it.
- Whether the same closed vote may be attached to one minutes document more than
  once as separate resolutions is left to planning; the spec assumes no
  uniqueness constraint unless one is decided then.
- The minutes export format (file type and layout of the human-readable
  document) is an implementation detail to be decided during `/speckit-plan`.
- The exact HTTP route shape for voting and minutes endpoints is an
  implementation detail to be decided during `/speckit-plan`, consistent with
  the org-nested meeting route conventions established in prior phases.
- Cursor-based pagination for the vote list follows the platform HTTP
  conventions from Phase 0 (default 20, max 100 per page).
- Rate limiting and audit-log query/export APIs are out of scope for this
  feature (they belong to Phase 5).
