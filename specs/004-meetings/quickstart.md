# Quickstart: Meetings Module

**Feature**: 004-meetings
**Purpose**: Verify the Meetings module end-to-end against a running server.

This walkthrough exercises every user story (US1–US5) and confirms all 5 audit
events. It assumes Phases 0–2 are in place: a verified user, an organization
whose onboarding step is `COMPLETE`, and a role that grants the `meeting:*`
permissions (or the caller is the org Owner).

## Prerequisites

- Server running locally (`pnpm dev`) with migrations applied.
- A verified user session — capture the access token as `$TOKEN`.
- An organization (`$ORG`) with `onboardingStep = COMPLETE`.
- The caller is the Owner of `$ORG`, or holds a role with `meeting:create`,
  `meeting:read`, `meeting:update`, and `meeting:cancel`.
- At least one other membership in `$ORG` to use as an attendee (`$MEMBER`).

All requests send `Authorization: Bearer $TOKEN` and `Content-Type: application/json`.

## 1. Create a meeting with an agenda (US1)

```
POST /api/v1/meetings/org/$ORG
{ "title": "Q2 Board Meeting", "location": "Room A",
  "scheduledAt": "<~10 minutes from now, ISO-8601>",
  "agendaItems": [ { "title": "Budget review", "orderIndex": 0 },
                   { "title": "Hiring plan", "orderIndex": 1 } ] }
```

Expect **201**, `status: "DRAFT"`, both agenda items in order, empty `attendees`.
Capture the id as `$MEETING`.

- Verify a meeting with no `agendaItems` also creates (empty agenda) → 201.
- Verify a meeting with `scheduledAt` in the past is rejected → 400
  `VALIDATION_ERROR`.

## 2. Edit the meeting before it starts (US5)

```
PATCH /api/v1/meetings/$MEETING/org/$ORG
{ "title": "Q2 Board Meeting (revised)",
  "agendaItems": [ { "title": "Budget review", "orderIndex": 0 } ] }
```

Expect **200**; the agenda is fully replaced by the single item.

## 3. Add an attendee, then schedule and open (US2 + US3)

```
POST  /api/v1/meetings/$MEETING/org/$ORG/attendees   { "memberIds": ["$MEMBER"] }
PATCH /api/v1/meetings/$MEETING/org/$ORG/status      { "status": "SCHEDULED" }
PATCH /api/v1/meetings/$MEETING/org/$ORG/status      { "status": "IN_PROGRESS" }
```

- The attendee add returns **200** with `$MEMBER` in `attendees`. Re-running it
  is idempotent — still one attendee.
- Adding a user who is not a member of `$ORG` → **404**.
- `DRAFT → SCHEDULED` → **200**.
- `SCHEDULED → IN_PROGRESS` succeeds because `scheduledAt` is within 15 minutes
  and there is ≥ 1 attendee → **200**.
- Negative check: with a meeting scheduled far in the future, `IN_PROGRESS`
  → **422** `MEETING_TOO_EARLY`. With zero attendees → **422**
  `INVALID_STATE_TRANSITION`.

## 4. Invalid transitions are rejected (US2)

```
PATCH /api/v1/meetings/$MEETING/org/$ORG/status   { "status": "DRAFT" }
```

Expect **422** `INVALID_STATE_TRANSITION` — `IN_PROGRESS → DRAFT` is not allowed.
Also confirm `DRAFT → COMPLETED` and any transition out of a `CANCELLED`/
`COMPLETED` meeting return **422**.

## 5. Complete the meeting (US2)

```
PATCH /api/v1/meetings/$MEETING/org/$ORG/status   { "status": "COMPLETED" }
```

Expect **200**, `status: "COMPLETED"`. The open-votes guard passes (no votes
exist yet). Confirm a follow-up edit or attendee change now returns **422**
`INVALID_STATE_TRANSITION` — the meeting is frozen.

## 6. List and filter (US4)

```
GET /api/v1/meetings/org/$ORG?status=COMPLETED
GET /api/v1/meetings/org/$ORG?attendeeId=$MEMBER&limit=20
```

Expect **200** with a paginated `items` array and a `nextCursor` field; each
filter narrows the result set correctly.

## 7. Audit log check

Query the audit log for `$ORG` and confirm all 5 events were recorded, each in
the same transaction as its write:

- `meeting.created` (step 1)
- `meeting.updated` (step 2)
- `meeting.attendee_added` (step 3)
- `meeting.status_changed` ×3 (step 3 and step 5 — `SCHEDULED`, `IN_PROGRESS`,
  `COMPLETED`)
- `meeting.attendee_removed` — exercise by removing `$MEMBER` from a meeting
  that is still `DRAFT`/`SCHEDULED`/`IN_PROGRESS`.

## Automated equivalent

The same flow is covered by the integration suite:

```
pnpm test tests/integration/modules/meetings
pnpm test tests/unit/modules/meetings/state-machine.test.ts
```

`state-machine.test.ts` asserts the full transition matrix (every allowed pair
passes, every other pair throws `INVALID_STATE_TRANSITION`). The integration
files cover one user story each and include rollback-injection checks so that a
forced mid-transaction failure leaves no meeting, agenda, attendee, or audit row
behind.
