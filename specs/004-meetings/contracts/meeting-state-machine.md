# Internal Contract: Meeting State Machine & Status Pre-handler

**Feature**: 004-meetings
**Consumers**: `meeting.service.ts`, `meeting.routes.ts`, the unit test suite

This is an internal contract — it governs module-private code, not an HTTP
surface. It is authored before implementation so the transition rules and the
status pre-handler behavior are fixed and testable.

---

## 1. Transition map (`utils/state-machine.ts` — pure)

```ts
type MeetingStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export const MEETING_TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  DRAFT: ['SCHEDULED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
```

`assertValidTransition(from, to)`:

- If `to` is not in `MEETING_TRANSITIONS[from]` → throw
  `AppError.invalidStateTransition(...)` (`INVALID_STATE_TRANSITION`, HTTP 422).
- Otherwise return void.
- This includes same-status requests (`from === to`) — never in the allowed
  list, always rejected.

The function is pure: no Fastify, no DB, no clock. It is called first in every
status transition, before any guard.

---

## 2. Guards (evaluated in `meeting.service.ts`, inside `withTx`)

Guards run only **after** `assertValidTransition` passes, and only for the
transition that needs them.

| Transition                    | Guard                                                               | Failure                          |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `SCHEDULED → IN_PROGRESS`     | meeting has ≥ 1 attendee                                            | `INVALID_STATE_TRANSITION` (422) |
| `SCHEDULED → IN_PROGRESS`     | `Date.now() ≥ scheduledAt − MEETING_EARLY_OPEN_MINUTES` (inclusive) | `MEETING_TOO_EARLY` (422)        |
| `IN_PROGRESS → COMPLETED`     | no row in `votes` with `meeting_id = id AND status = 'OPEN'`        | `MEETING_HAS_OPEN_VOTES` (409)   |
| all other allowed transitions | none                                                                | —                                |

`MEETING_EARLY_OPEN_MINUTES = 15` (named constant in `constants/index.ts`).

The open-votes guard queries the existing `votes` table
(`votes_meeting_status_idx`). Until the Phase 4 vote module exists the count is
always 0, so the guard passes truthfully.

---

## 3. Status-transition permission pre-handler

`requireStatusTransitionPermission` (`pre-handlers/status-permission.ts`) gates
`PATCH /api/v1/meetings/{meetingId}/org/{orgId}/status`.

Behavior:

1. Read `request.body.status` (the request body is validated and available at
   the `preHandler` stage).
2. Choose the permission key:
   - target `=== 'CANCELLED'` → `meeting:cancel`
   - any other target → `meeting:update`
3. Delegate to the shared `requirePermission(key)` pre-handler — which resolves
   the caller's membership, applies the org-Owner bypass, and throws `FORBIDDEN`
   if the key is absent.

This keeps a single status endpoint while honoring the two distinct permissions
required by FR-313. A caller holding only `meeting:cancel` can cancel a meeting
but cannot drive any other transition.

---

## 4. Pre-handler chain per route

| Route                                                        | Pre-handlers                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `POST   /meetings/org/:orgId`                                | `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:create')` |
| `GET    /meetings/org/:orgId`                                | `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:read')`   |
| `GET    /meetings/:meetingId/org/:orgId`                     | `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:read')`   |
| `PATCH  /meetings/:meetingId/org/:orgId`                     | `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:update')` |
| `PATCH  /meetings/:meetingId/org/:orgId/status`              | `identityRequired, attachOrgId, requireOnboardingStep('complete'), requireStatusTransitionPermission`   |
| `POST   /meetings/:meetingId/org/:orgId/attendees`           | `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:update')` |
| `DELETE /meetings/:meetingId/org/:orgId/attendees/:memberId` | `identityRequired, attachOrgId, requireOnboardingStep('complete'), requirePermission('meeting:update')` |

---

## 5. Transaction & audit contract

Every state-changing service method opens one `withTx` block that performs the
write(s) and the matching `emitAudit(tx, …)` call together:

| Operation         | Writes                                                | Audit event                 |
| ----------------- | ----------------------------------------------------- | --------------------------- |
| create            | `meetings` insert + `meeting_agenda_items` inserts    | `meeting.created`           |
| update            | `meetings` update (+ agenda delete/insert)            | `meeting.updated`           |
| status transition | `meetings.status` update                              | `meeting.status_changed`    |
| add attendees     | `meeting_attendees` insert (`ON CONFLICT DO NOTHING`) | `meeting.attendee_added` ×N |
| remove attendee   | `meeting_attendees` delete                            | `meeting.attendee_removed`  |

If the transaction rolls back, the audit row rolls back with it — no ghost
entries (Constitution audit invariant, FR-315).
