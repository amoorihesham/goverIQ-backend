# Quickstart: Voting & Minutes

**Feature**: 005-voting-minutes
**Purpose**: Verify the Votes and Minutes modules end-to-end against a running
server.

This walkthrough exercises every user story (US1–US7) and confirms all 8 audit
events. It assumes Phases 0–3 are in place: a verified user, an organization
whose onboarding step is `COMPLETE`, a role granting the `vote:*` and
`minutes:*` permissions (or the caller is the org Owner), and a meeting that can
be driven through its lifecycle.

## Prerequisites

- The additive migration is applied: `pnpm db:generate` then `pnpm db:migrate`
  (adds `votes.affirmative_option`).
- Server running locally (`pnpm dev`) with migrations applied.
- A verified user session — capture the access token as `$TOKEN`.
- An organization (`$ORG`) with `onboardingStep = COMPLETE`.
- The caller is the Owner of `$ORG`, or holds a role with `vote:create`,
  `vote:read`, `vote:cast_ballot`, `vote:close`, `minutes:create`,
  `minutes:update`, `minutes:finalize`, and `minutes:read`.
- At least one other membership in `$ORG` to use as an attendee/voter
  (`$MEMBER`).
- A meeting (`$MEETING`) created, with `$MEMBER` (and the caller) added as
  attendees, driven to `IN_PROGRESS` via the meetings endpoints.

All requests send `Authorization: Bearer $TOKEN` and `Content-Type: application/json`.

## 1. Create a vote with a frozen eligibility snapshot (US1)

```
POST /api/v1/votes/meeting/$MEETING/org/$ORG
{ "question": "Approve the Q3 budget?",
  "options": ["Approve", "Reject", "Abstain"],
  "affirmativeOption": "Approve",
  "deadline": "<~1 day from now, ISO-8601>",
  "eligibleMemberIds": null }
```

Expect **201**, `status: "OPEN"`, `outcome: null`, `resultSummary: null`. Capture
the id as `$VOTE`.

- With `eligibleMemberIds: null`, the eligible set is the meeting's current
  attendees, captured now. Add a _new_ attendee to `$MEETING` afterward, then
  `GET` the vote's eligibility (or attempt a ballot as the new attendee in
  step 2) and confirm the snapshot still holds only the original members
  (SC-402).
- A vote against a meeting that is not `IN_PROGRESS` → **422**
  `INVALID_STATE_TRANSITION`.
- `options` with fewer than two distinct values, or `affirmativeOption` not in
  `options`, or `eligibleMemberIds: []` → **400** `VALIDATION_ERROR`.
- An explicit `eligibleMemberIds` containing a non-attendee → **404**.

## 2. Cast ballots in the open vote (US2)

```
POST /api/v1/votes/$VOTE/meeting/$MEETING/org/$ORG/ballots   { "choice": "Approve" }
```

- As an eligible member with a valid choice → **201**.
- A second ballot from the same member → **409** `DUPLICATE_BALLOT`.
- A ballot from a member outside the eligibility snapshot → **403** `FORBIDDEN`.
- A `choice` not in the vote's options → **400** `VALIDATION_ERROR`.
- Confirm no read response (`GET` the vote, list votes) ever shows which member
  chose which option — only the aggregate `resultSummary` (SC-404).

## 3. The open vote blocks meeting completion (US3 + FR-410)

```
PATCH /api/v1/meetings/$MEETING/org/$ORG/status   { "status": "COMPLETED" }
```

Expect **409** `MEETING_HAS_OPEN_VOTES` — the meeting cannot complete while
`$VOTE` is `OPEN`. (No meeting-module code changed; the guard was already wired.)

## 4. Close the vote and compute its outcome (US3)

```
PATCH /api/v1/votes/$VOTE/meeting/$MEETING/org/$ORG/close
```

Expect **200**, `status: "CLOSED"`, `closedAt` set, and an `outcome` with a
`resultSummary` holding `tally`, `totalEligible`, `totalCast`, and `winner`.

- Quorum met with a clear winner on the affirmative option → `outcome: "PASSED"`.
  A clear winner on another option → `"FAILED"`; a tie → `"TIED"`; too few
  ballots for the org's quorum threshold → `"QUORUM_NOT_MET"` (SC-405).
- Closing an already-`CLOSED` vote → **409** `CONFLICT`.

## 5. Complete the meeting (US3)

```
PATCH /api/v1/meetings/$MEETING/org/$ORG/status   { "status": "COMPLETED" }
```

Now that every vote is `CLOSED`, expect **200**, `status: "COMPLETED"` (SC-406).

## 6. Create and revise draft minutes (US4)

```
POST  /api/v1/minutes/meeting/$MEETING/org/$ORG   { "summary": "Q3 board meeting." }
PATCH /api/v1/minutes/meeting/$MEETING/org/$ORG   { "attendanceNotes": "All members present." }
POST  /api/v1/minutes/meeting/$MEETING/org/$ORG/resolutions
      { "voteId": "$VOTE", "description": "The Q3 budget was approved." }
```

- Create → **201**, `status: "DRAFT"`.
- A second create for the same meeting → **409** `CONFLICT`.
- Creating minutes for a meeting that is not `COMPLETED` → **422**
  `INVALID_STATE_TRANSITION`.
- Edit → **200**. Attach resolution referencing the `CLOSED` `$VOTE` → **201**.
- A resolution referencing a non-closed vote, or a vote from another meeting →
  **400** `VALIDATION_ERROR`.

## 7. Finalize the minutes into an immutable record (US5)

```
POST /api/v1/minutes/meeting/$MEETING/org/$ORG/finalize
```

Expect **200**, `status: "FINALIZED"`, `finalizedAt` set.

- A follow-up `PATCH` edit → **422** `MINUTES_FINALIZED`.
- A follow-up resolution attach → **422** `MINUTES_FINALIZED`.
- A second finalize → **409** `CONFLICT` (SC-408).

## 8. Append corrections to the finalized minutes (US6)

```
POST /api/v1/minutes/meeting/$MEETING/org/$ORG/corrections
     { "content": "Correction: the budget figure was $1.2M, not $1.1M." }
```

- Against a `FINALIZED` document → **201**; the finalized body is unchanged.
- Append a second correction, then read the minutes (step 9) and confirm both
  corrections appear in chronological order.
- A correction against a `DRAFT` document → **422** `INVALID_STATE_TRANSITION`.

## 9. Read and export (US7)

```
GET /api/v1/votes/meeting/$MEETING/org/$ORG
GET /api/v1/minutes/meeting/$MEETING/org/$ORG
GET /api/v1/minutes/meeting/$MEETING/org/$ORG/export
```

- Vote list → **200** with each vote's aggregate `resultSummary`, no per-member
  ballot data.
- Minutes read → **200** with the minutes body, resolutions, and corrections;
  readable by **any** member of `$ORG` (identity only — verify a member without
  `minutes:read` can still read).
- Export → **200**, `Content-Type: application/pdf`, a `Content-Disposition`
  attachment header, and a valid PDF containing the meeting details, minutes
  body, resolutions, and corrections.
- Reading or exporting minutes for a meeting with no minutes document → **404**.

## 10. Audit log check

Query the audit log for `$ORG` and confirm all 8 events were recorded, each in
the same transaction as its write:

- `vote.created` (step 1)
- `ballot.submitted` (step 2 — once per ballot; payload carries no choice)
- `vote.closed` (step 4 — payload carries the outcome)
- `minutes.created` (step 6)
- `minutes.updated` (step 6 — the edit)
- `minutes.finalized` (step 7)
- `minutes.correction_added` (step 8)
- `minutes.exported` (step 9)

Attaching a resolution emits **no** audit event (research Decision 13).

## Automated equivalent

The same flow is covered by the integration suite:

```
pnpm test tests/integration/modules/votes
pnpm test tests/integration/modules/minutes
pnpm test tests/unit/modules/votes/outcome.test.ts
```

`outcome.test.ts` asserts the full outcome matrix (quorum-not-met, tie,
passed, failed, zero-ballot, zero-threshold). The integration files cover one
user-story slice each and include rollback-injection checks so that a forced
mid-transaction failure leaves no vote, eligibility, ballot, minutes,
resolution, correction, or audit row behind.
