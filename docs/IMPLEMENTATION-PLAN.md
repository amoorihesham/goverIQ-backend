# Implementation Plan

## GovernIQ — Organizational Governance & Meeting Intelligence Platform

**Version:** 1.0
**Status:** Draft
**Date:** May 1, 2026
**Derived from:** HLD v1.0

---

## How to Read This Document

Each phase is a vertical slice that must be fully complete before the next begins. A phase is complete only when its **Done When** criteria are all satisfied — not when the code is written, but when the behavior is verified end-to-end.

Phases are ordered by dependency, not arbitrary sequence:

- Phase 0 unlocks everything (schema + infrastructure)
- Phase 1 unlocks protected routes
- Phase 2 unlocks org-scoped operations
- Phase 3 unlocks votes and minutes
- Phase 4 unlocks the full governance cycle
- Phase 5 finalizes the system for production

---

## Non-Negotiable Principles

These seven rules are enforced at every phase. No feature ships without satisfying all that apply.

1. **Transactional Audit Logging** — every audit entry is written inside the same database transaction as the write it describes. If the write rolls back, the audit entry rolls back with it. No ghost entries.
2. **Server-Side Permission Enforcement** — permissions are resolved per-request from the database. No client-provided role claims. No caching.
3. **Strict State Machines** — invalid transitions are rejected at the server. Clients cannot skip steps or navigate around enforcement.
4. **Immutable Finalized Records** — finalized minutes cannot be edited. Corrections are append-only notices. The document itself remains locked.
5. **Server-Enforced Onboarding** — clients cannot access the main application until all onboarding steps are complete. The server evaluates and enforces the current step on every request.
6. **Single-Owner Org Invariant** — the last Owner of an organization cannot be removed. No org is left ownerless.
7. **No Hard Deletes** — data is never permanently destroyed. Archiving sets a timestamp and excludes records from normal queries; the data is preserved.

---

## Phase 0 — Schema & Shared Infrastructure

**Goal:** All data tables defined and migrated in a single operation. All cross-cutting infrastructure is operational before any domain module is built.

### Why Upfront Schema

All 17 tables are defined and migrated once, before Phase 1 begins. Idle tables cause no harm. Doing it in a single migration prevents churn across phases — no incremental schema additions or destructive alterations mid-build.

### Data Schema

17 tables across 6 domains:

**Auth domain**

- `users` — identity record; email, password hash, verification flag
- `email_verifications` — OTP hash, expiry, resend cooldown tracking; foreign key to user; deleted on successful verification
- `refresh_tokens` — stored as hash; one row per active session; deleted on use or logout

**Org / Role / Member domain**

- `organizations` — name (globally unique, case-insensitive), slug, description, quorum threshold, onboarding step, archived timestamp
- `roles` — named permission collections scoped to an org; `is_owner` flag protects the system Owner role
- `memberships` — links a user to an org with a role; unique per (user, org)
- `invitations` — email, role, hashed token, status (`PENDING` / `ACCEPTED` / `DECLINED` / `EXPIRED`), expiry; partial unique index on (org, email) where pending

**Meeting domain**

- `meetings` — title, description, location, scheduled time, status
- `meeting_agenda_items` — ordered items linked to a meeting
- `meeting_attendees` — composite PK (meeting, member); no extra columns

**Vote domain**

- `votes` — question, options list, status, outcome, result summary (aggregate counts), deadline
- `vote_eligibility` — immutable snapshot of eligible members at vote creation time; insert-only
- `ballots` — one row per member per vote; unique constraint enforces one-ballot rule

**Minutes domain**

- `minutes` — summary, attendance notes, status (`DRAFT` / `FINALIZED`), finalized timestamp; unique on meeting (one per meeting)
- `minutes_resolutions` — references a closed vote with a description
- `minutes_corrections` — timestamped append-only notices; linked to finalized minutes

**Audit domain**

- `audit_logs` — actor, event type, entity type, entity ID, payload (`{before, after}` or `{data}`), timestamp; INSERT-only at every layer including database

**Audit log indexes:** `(org_id, created_at DESC)`, `(org_id, actor_id)`, `(org_id, event)`, `(org_id, entity_type, entity_id)`

### Shared Infrastructure

Five components built once and shared across all domain modules. No domain module reimplements any of these.

**1. System Permission Set**

A fixed registry of 22 permission keys across 6 domains, defined at startup. Organizations cannot add or remove entries.

| Domain       | Permissions                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Organization | `org:update`, `org:archive`                                                                             |
| Roles        | `role:create`, `role:update`, `role:delete`, `role:assign`, `role:revoke`                               |
| Members      | `member:invite`, `member:remove`                                                                        |
| Meetings     | `meeting:create`, `meeting:update`, `meeting:manage_attendees`, `meeting:change_status`, `meeting:view` |
| Voting       | `vote:create`, `vote:submit`, `vote:close`, `vote:view_results`                                         |
| Minutes      | `minutes:create`, `minutes:edit`, `minutes:finalize`, `minutes:export`                                  |
| Audit        | `audit:view`, `audit:export`                                                                            |

**2. Error Types & Response Envelope**

All responses follow a single shape:

```
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": { "code": "MACHINE_CODE", "message": "...", "statusCode": 422 } }
```

Machine-readable error codes:

| Code                       | HTTP | Meaning                                           |
| -------------------------- | ---- | ------------------------------------------------- |
| `UNAUTHORIZED`             | 401  | Missing or invalid access credential              |
| `FORBIDDEN`                | 403  | Authenticated but lacks required permission       |
| `NOT_FOUND`                | 404  | Resource does not exist                           |
| `CONFLICT`                 | 409  | Duplicate resource or invalid state               |
| `INVALID_STATE_TRANSITION` | 422  | State machine violation                           |
| `MEETING_TOO_EARLY`        | 422  | Opening meeting > 15 min before scheduled time    |
| `MEETING_HAS_OPEN_VOTES`   | 422  | Completing a meeting with open votes              |
| `VOTE_CLOSED`              | 422  | Submitting a ballot to a closed vote              |
| `DUPLICATE_BALLOT`         | 409  | Member already voted                              |
| `MINUTES_FINALIZED`        | 422  | Editing finalized minutes                         |
| `OTP_EXPIRED`              | 422  | Submitted OTP has expired                         |
| `OTP_COOLDOWN`             | 422  | OTP resend requested too soon                     |
| `PRIVILEGE_ESCALATION`     | 403  | Role contains permissions the caller doesn't hold |
| `ROLE_IN_USE`              | 409  | Deleting a role with active members               |
| `SOLE_OWNER`               | 409  | Removing the only Owner of an org                 |
| `PENDING_INVITE_EXISTS`    | 409  | Duplicate pending invite for same email + org     |
| `INTERNAL_ERROR`           | 500  | Unexpected server error                           |

**3. Audit Emitter**

An internal function called by domain modules after every successful state-changing operation. It writes the audit entry into the **same database transaction** as the originating write.

Contract:

```
emitAudit(transaction, {
  orgId,
  actorId,
  event,        ← e.g. "org.created"
  entityType,   ← e.g. "organization"
  entityId,
  payload       ← { before, after } for mutations; { data } for creations
})
```

Rule: never called with the global database connection. Always called with the active transaction handle.

**4. Notification Service**

An abstraction over external notification delivery. Domain modules call it with a template name and typed data payload — the underlying mechanism is opaque to the caller.

Two templates in MVP:

- `email-verification` — delivers OTP to a registering user
- `invitation` — delivers accept/decline links to an invited email

Delivery is fire-and-forget. Failures are logged but do not propagate to the caller. No retry queue in MVP.

**5. Permission Guard**

A request-intercepting function attached as a pre-handler to every protected route. Execution order:

```
1. Extract access credential from request
2. Validate credential (reject if missing or expired)
3. Resolve caller's membership in target org (from request path parameter)
4. If caller is org Owner → pass unconditionally
5. Load permissions from caller's role
6. Check required permission is present → block with FORBIDDEN if not
```

Permission resolution happens per-request from the database. No caching. This guarantees role permission changes take effect on the very next request after they are saved.

### HTTP Conventions

- **Base path:** `/api/v1` for all domain routes; `/auth` for auth routes; `/invitations` for public invite routes
- **Content-Type:** `application/json`
- **Timestamps:** ISO 8601 UTC
- **Pagination:** cursor-based — `?cursor=<opaqueToken>&limit=<n>` (default 20, max 100); response includes `nextCursor` if further results exist
- **Auth header:** `Authorization: Bearer <accessCredential>`

### Phase 0 Done When

- [ ] All 17 tables migrate cleanly from a blank database in a single operation
- [ ] Server starts and refuses to start with any required configuration variable missing
- [ ] System permission set is accessible as a typed constant
- [ ] Error types and response helpers produce the correct envelope shapes
- [ ] Audit Emitter function is importable and callable inside a transaction
- [ ] Notification Service abstraction is wired to a working delivery mechanism
- [ ] Permission Guard correctly resolves membership, loads role permissions, and enforces the Owner bypass

---

## Phase 1 — Auth Module

**Goal:** A user can register, verify their email, log in, refresh their session, and log out. All session security invariants are enforced.

### Session Model

| Credential                    | Lifetime                  | Stored                        | Transported          |
| ----------------------------- | ------------------------- | ----------------------------- | -------------------- |
| Access credential (stateless) | Short-lived (e.g. 15 min) | Not stored                    | Authorization header |
| Refresh credential (opaque)   | Long-lived (e.g. 7 days)  | As a hash in `refresh_tokens` | httpOnly cookie      |

**Access credential payload:** caller identity (user ID, email). No org context or role — resolved per-request in Phase 2+.

**Refresh token lifecycle:**

- On login / verify-email: generate random token → hash → store in DB → set as httpOnly cookie
- On refresh: read cookie → find matching hash → delete old row → insert new row → issue new pair
- On reuse (token hash not found): delete **all** `refresh_tokens` for that user → return `UNAUTHORIZED` (theft signal)
- On logout: delete matching row → clear cookie

**Identity preHandler:** attached to every protected route. Validates access credential. Attaches `{ userId, email }` to request context. Throws `UNAUTHORIZED` on missing or expired credential.

### Endpoints

**`POST /auth/register`**
Body: `{ email, password }`

- Hash password
- Create unverified user
- Generate 6-digit OTP → hash → store in `email_verifications` with expiry
- Send `email-verification` notification
- Emit: `user.registered`

Response 201: `{ message: "Verification email sent." }`

---

**`POST /auth/verify-email`**
Body: `{ email, otp }`

- Find verification record for user
- Check expiry → throw `OTP_EXPIRED` if past
- Compare OTP with stored hash
- Mark user `is_verified = true`
- Delete verification record
- Issue access credential + set refresh token cookie
- Emit: `user.verified`

Response 200 + Set-Cookie: `{ accessToken }`

---

**`POST /auth/resend-otp`**
Body: `{ email }`

- Find user and verification record
- Check cooldown (last sent + cooldown window > now) → throw `OTP_COOLDOWN` if true
- Generate new OTP → update record
- Resend `email-verification` notification

Response 200: `{ message: "OTP resent." }`

---

**`POST /auth/login`**
Body: `{ email, password }`

- Find user by email → throw `NOT_FOUND` if absent
- Check `is_verified` → throw `UNAUTHORIZED` if false
- Compare password → throw `UNAUTHORIZED` if mismatch
- Issue access credential + set refresh token cookie
- Emit: `user.login`

Response 200 + Set-Cookie: `{ accessToken }`

---

**`POST /auth/refresh`**
No body — reads refresh credential from cookie.

- Hash cookie value → find matching `refresh_tokens` row
- If not found → delete all tokens for that user → throw `UNAUTHORIZED` (reuse detected)
- Check expiry
- Delete old row → insert new row
- Issue new access credential + rotate cookie

Response 200 + Set-Cookie: `{ accessToken }`

---

**`POST /auth/logout`**
No body — reads refresh credential from cookie.

- Delete matching `refresh_tokens` row
- Clear cookie
- Emit: `user.logout`

Response 204

### Audit Events

| Event             | Trigger                     |
| ----------------- | --------------------------- |
| `user.registered` | Successful registration     |
| `user.verified`   | Successful OTP verification |
| `user.login`      | Successful login            |
| `user.logout`     | Logout                      |

### Phase 1 Done When

- [ ] Registration creates an unverified user and triggers a notification
- [ ] OTP verification marks user verified and issues a valid session
- [ ] OTP expiry is enforced — expired OTPs are rejected
- [ ] OTP resend cooldown is enforced
- [ ] Login is blocked for unverified users
- [ ] Refresh rotates the cookie and issues a new access credential
- [ ] Refresh token reuse returns `UNAUTHORIZED` and invalidates all sessions for that user
- [ ] Logout deletes the token row and clears the cookie
- [ ] Identity preHandler rejects requests with missing or expired access credentials
- [ ] All 4 audit events confirmed in the log after running each flow

---

## Phase 2 — Organization, Roles & Members

**Goal:** Owner can create an org and complete the onboarding sequence. Custom roles can be defined from the system permission set. Members can be invited, join, and be managed.

### Organization Module (5 endpoints)

**`POST /api/v1/orgs`**
Identity required.
Body: `{ name, description?, logoUrl? }`

Inside a **single transaction**:

- Check name uniqueness (case-insensitive) → throw `CONFLICT` if taken
- Insert organization with `onboardingStep = PENDING_ROLES`
- Insert Owner role (`is_owner = true`, all 22 permissions)
- Insert membership linking caller → org → Owner role
- Emit: `org.created`

Response 201: org object with `onboardingStep`

---

**`GET /api/v1/orgs/:orgId`** — read org profile. Identity required.

**`PATCH /api/v1/orgs/:orgId`** — update profile fields. Requires `org:update`. Name uniqueness re-checked if changing name. Emit: `org.updated`.

**`DELETE /api/v1/orgs/:orgId`** — archive org. Owner only. Sets `archived_at`. Emit: `org.archived`. Response 204.

**`GET /api/v1/orgs/:orgId/onboarding`** — read current onboarding step. Identity required.

### Onboarding Enforcement Middleware

Registered on all non-auth, non-public routes. Runs after identity validation. Loads org's `onboardingStep` and enforces:

```
PENDING_ROLES   → only role-creation routes pass through; all others blocked
PENDING_INVITES → invite routes and the skip-step route pass through; others blocked
COMPLETE        → all routes pass through
```

The client cannot bypass a step by navigating directly. The server evaluates and enforces the current step on every request.

**Advancing onboarding:**

- `PENDING_ROLES → PENDING_INVITES`: triggered when the first custom (non-Owner) role is created in the org
- `PENDING_INVITES → COMPLETE`: triggered when an invitation is accepted, or the step is explicitly skipped

Both advances happen inside the same transaction as the triggering write.

### Role Module (6 endpoints)

**`GET /api/v1/orgs/:orgId/roles/permissions`** — returns all 22 system permission keys. Identity required.

**`POST /api/v1/orgs/:orgId/roles`** — create custom role. Requires `role:create`.

- Validate all provided permission keys exist in the system set
- **Privilege escalation check:** caller's own permissions must be a superset of the permissions being assigned → throw `PRIVILEGE_ESCALATION` if not
- Check name uniqueness within org (case-insensitive)
- Insert role
- If this is the **first non-Owner role** in the org → advance `onboardingStep` to `PENDING_INVITES` in same transaction
- Emit: `role.created`

**`GET /api/v1/orgs/:orgId/roles`** — list all roles (including Owner). Identity required.

**`GET /api/v1/orgs/:orgId/roles/:roleId`** — read single role. Identity required.

**`PATCH /api/v1/orgs/:orgId/roles/:roleId`** — update name or permissions. Requires `role:update`.

- Blocked if `role.is_owner = true`
- Privilege escalation check on new permissions
- Name uniqueness check if changing name
- Changes take effect immediately for all members holding this role
- Emit: `role.updated`

**`DELETE /api/v1/orgs/:orgId/roles/:roleId`** — delete role. Requires `role:delete`.

- Blocked if `role.is_owner = true`
- Count active memberships with this role → throw `ROLE_IN_USE` if any exist
- Emit: `role.deleted`. Response 204.

### Member Module (7 endpoints)

**`POST /api/v1/orgs/:orgId/members/invitations`** — send invitation. Requires `member:invite`.

- Verify at least one custom role exists → throw `CONFLICT` if not
- Check no pending invite for this email in this org → throw `PENDING_INVITE_EXISTS` if so
- Verify target role belongs to this org and is not Owner
- Generate random token → hash → store in `invitations` with expiry
- Send `invitation` notification with accept/decline links (raw token in URL)
- Emit: `member.invited`

**`POST /invitations/:token/accept`** — public route.

- Hash token → find matching invitation
- Validate `expires_at > now` and `status = PENDING`
- If email has no account → create user (registration via invitation flow)
- If email has existing account → use that user
- Upsert membership (user → org → invited role)
- Set invitation `status = ACCEPTED`
- If org `onboardingStep = PENDING_INVITES` → advance to `COMPLETE` in same transaction
- Emit: `member.joined`

**`POST /invitations/:token/decline`** — public route.

- Find invitation by token hash
- Set `status = DECLINED`
- Emit: `member.declined`

**`GET /api/v1/orgs/:orgId/members`** — paginated member list. Identity required. Each entry includes user identity, role name, and join date.

**`DELETE /api/v1/orgs/:orgId/members/:memberId`** — remove member. Requires `member:remove`.

- If target member's role is Owner → throw `SOLE_OWNER`
- Delete membership
- Emit: `member.removed`. Response 204.

**`PUT /api/v1/orgs/:orgId/members/:memberId/role`** — assign role. Requires `role:assign`.

- Verify role belongs to this org
- Privilege escalation check on new role's permissions
- Update membership
- Emit: `member.role_assigned`

**`DELETE /api/v1/orgs/:orgId/members/:memberId/role`** — revoke role. Requires `role:revoke`.

- Blocked if target role `is_owner = true`
- Set membership role to null
- Emit: `member.role_revoked`. Response 204.

### Audit Events

| Event                  | Trigger                          |
| ---------------------- | -------------------------------- |
| `org.created`          | Org created                      |
| `org.updated`          | Org profile updated              |
| `org.archived`         | Org archived                     |
| `role.created`         | Custom role created              |
| `role.updated`         | Role name or permissions updated |
| `role.deleted`         | Role deleted                     |
| `member.invited`       | Invitation sent                  |
| `member.joined`        | Invitation accepted              |
| `member.declined`      | Invitation declined              |
| `member.removed`       | Member removed from org          |
| `member.role_assigned` | Role assigned to member          |
| `member.role_revoked`  | Role revoked from member         |

### Phase 2 Done When

- [ ] Owner creates org — Owner role and membership created atomically in one transaction
- [ ] Org name uniqueness (case-insensitive) enforced
- [ ] Onboarding middleware blocks non-onboarding routes until `COMPLETE`
- [ ] System permissions list returns all 22 keys
- [ ] Owner can create custom roles with any subset of permissions
- [ ] Privilege escalation is rejected on role create and update
- [ ] Owner role cannot be deleted or modified
- [ ] First custom role advances onboarding to `PENDING_INVITES`
- [ ] Invitation email is sent; accept and decline links work
- [ ] Accepting an invitation creates the membership with the correct role
- [ ] Accepting advances onboarding to `COMPLETE`
- [ ] Duplicate pending invite is rejected
- [ ] Sole Owner cannot be removed
- [ ] All 12 audit events confirmed

---

## Phase 3 — Meetings

**Goal:** Members can create and manage meetings through their full status lifecycle. All state machine guards are enforced at the server.

### Meeting Module (7 endpoints)

**`POST /api/v1/orgs/:orgId/meetings`** — create meeting. Requires `meeting:create`.
Body: `{ title, description?, location?, scheduledAt, agendaItems: [{ title, description?, orderIndex }] }`

- Insert meeting with status `DRAFT`
- Insert agenda items
- Emit: `meeting.created`

**`GET /api/v1/orgs/:orgId/meetings`** — paginated list. Requires `meeting:view`.
Filters: `status`, `from` (date), `to` (date), `attendeeId`

**`GET /api/v1/orgs/:orgId/meetings/:meetingId`** — full meeting detail including agenda and attendee list. Requires `meeting:view`.

**`PATCH /api/v1/orgs/:orgId/meetings/:meetingId`** — update details. Requires `meeting:update`.

- Blocked if status is not `DRAFT` or `SCHEDULED` → throw `INVALID_STATE_TRANSITION`
- If `agendaItems` provided: replace all items (delete existing, re-insert)
- Emit: `meeting.updated`

**`PATCH /api/v1/orgs/:orgId/meetings/:meetingId/status`** — transition status. Requires `meeting:change_status`.
Body: `{ status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" }`

- Run transition validator (allowed transitions map)
- Evaluate all guards for the requested transition
- Update status
- Emit: `meeting.status_changed` with `{ before, after }`

**`POST /api/v1/orgs/:orgId/meetings/:meetingId/attendees`** — add attendees. Requires `meeting:manage_attendees`.
Body: `{ memberIds: [uuid] }`

- Verify all member IDs are current org memberships
- Upsert attendee rows (ignore already-present)
- Emit: `meeting.attendee_added` per added member

**`DELETE /api/v1/orgs/:orgId/meetings/:meetingId/attendees/:memberId`** — remove attendee. Requires `meeting:manage_attendees`.

- Emit: `meeting.attendee_removed`. Response 204.

### Status State Machine

```
DRAFT → SCHEDULED → IN_PROGRESS → COMPLETED
             ↓            ↓
          CANCELLED    CANCELLED
```

**Allowed transition map:**

| From          | To            | Guard                                         |
| ------------- | ------------- | --------------------------------------------- |
| `DRAFT`       | `SCHEDULED`   | None                                          |
| `SCHEDULED`   | `IN_PROGRESS` | ≥ 1 attendee AND `now ≥ scheduledAt − 15 min` |
| `SCHEDULED`   | `CANCELLED`   | None                                          |
| `IN_PROGRESS` | `COMPLETED`   | No votes in `OPEN` status                     |
| `IN_PROGRESS` | `CANCELLED`   | None                                          |
| Any           | Any other     | → `INVALID_STATE_TRANSITION`                  |

**Note on the `IN_PROGRESS → COMPLETED` guard:** this guard is wired in Phase 3 and evaluates truthfully now (no votes exist yet). It activates with real enforcement in Phase 4 once the vote module is built.

**Error codes for transition failures:**

- `MEETING_TOO_EARLY` — time window guard not met
- `INVALID_STATE_TRANSITION` — illegal transition attempted
- `MEETING_HAS_OPEN_VOTES` — open votes block completion (activates Phase 4)

### Audit Events

| Event                      | Trigger                 |
| -------------------------- | ----------------------- |
| `meeting.created`          | Meeting created         |
| `meeting.updated`          | Meeting details updated |
| `meeting.status_changed`   | Any status transition   |
| `meeting.attendee_added`   | Attendee added          |
| `meeting.attendee_removed` | Attendee removed        |

### Phase 3 Done When

- [ ] Meeting created with agenda items; status starts as `DRAFT`
- [ ] List endpoint supports all filters and cursor pagination
- [ ] All valid status transitions work
- [ ] Invalid transitions (skipping states, re-opening `CANCELLED`) are rejected
- [ ] `SCHEDULED → IN_PROGRESS` blocked if attendee count is 0
- [ ] `SCHEDULED → IN_PROGRESS` blocked if called > 15 min before `scheduledAt`
- [ ] `SCHEDULED → IN_PROGRESS` succeeds within the 15-min window with ≥ 1 attendee
- [ ] `CANCELLED` cannot be transitioned further
- [ ] Meeting details cannot be edited in `IN_PROGRESS` or later
- [ ] Attendees must be current org members — non-members are rejected
- [ ] All 5 audit events confirmed

---

## Phase 4 — Voting & Minutes

**Goal:** Formal votes can be created, ballots submitted, and outcomes calculated within meetings. Minutes can be created, finalized, and exported. The `IN_PROGRESS → COMPLETED` guard now actively blocks meetings with open votes.

### Vote Module (5 endpoints)

**`POST /api/v1/orgs/:orgId/meetings/:meetingId/votes`** — create vote. Requires `vote:create`.
Body: `{ question, options: [string], deadline, eligibleMemberIds: [uuid] | null }`

- Verify meeting status is `IN_PROGRESS` → throw `INVALID_STATE_TRANSITION` if not
- `eligibleMemberIds: null` → eligible set = all current meeting attendees
- `eligibleMemberIds: [...]` → validate each is a meeting attendee
- Inside transaction:
  - Insert vote row
  - Insert `vote_eligibility` rows (snapshot — immutable after this point)
  - Emit: `vote.created`

**`GET /api/v1/orgs/:orgId/meetings/:meetingId/votes`** — list votes. Requires `vote:view_results`.
Returns aggregate result summaries. Per-member ballot choices are never exposed.

**`GET /api/v1/orgs/:orgId/meetings/:meetingId/votes/:voteId`** — read single vote. Requires `vote:view_results`.

**`POST /api/v1/orgs/:orgId/meetings/:meetingId/votes/:voteId/ballots`** — submit ballot. Requires `vote:submit`.
Body: `{ choice: string }`

- Verify vote `status = OPEN` → throw `VOTE_CLOSED` if not
- Verify caller's membership is in `vote_eligibility` → throw `FORBIDDEN` if not
- Verify `choice` is in `vote.options` → throw `400` if not
- Insert ballot row — unique constraint rejects duplicate → translate to `DUPLICATE_BALLOT`
- Emit: `ballot.submitted`

**`PATCH /api/v1/orgs/:orgId/meetings/:meetingId/votes/:voteId/close`** — close vote. Requires `vote:close`.

- Verify vote `status = OPEN` → throw `CONFLICT` if already closed
- Calculate result:
  1. Count ballots per choice
  2. `total_eligible` = count of eligibility rows
  3. `total_cast` = count of ballot rows
  4. Quorum check: `total_cast / total_eligible >= org.quorumThreshold`
  5. If quorum not met → outcome = `QUORUM_NOT_MET`
  6. If quorum met → find max-count choice; tie → `TIED`; clear winner → `PASSED` or `FAILED`
- Inside transaction:
  - Update vote: `status = CLOSED`, `outcome`, `result_summary`, `closed_at`
  - Emit: `vote.closed` with outcome in payload

**Wire `IN_PROGRESS → COMPLETED` guard** — update the meeting service transition check to query for open votes in the meeting. If any exist → throw `MEETING_HAS_OPEN_VOTES`. This guard is now active.

### Minutes Module (6 endpoints)

**`POST /api/v1/orgs/:orgId/meetings/:meetingId/minutes`** — create minutes. Requires `minutes:create`.
Body: `{ summary?, attendanceNotes? }`

- Verify meeting status is `COMPLETED` → throw `INVALID_STATE_TRANSITION` if not
- Unique constraint on `meeting_id` prevents a second document → translate to `CONFLICT`
- Insert minutes with `status = DRAFT`
- Emit: `minutes.created`

**`GET /api/v1/orgs/:orgId/meetings/:meetingId/minutes`** — read minutes. Identity required.
Response includes the minutes body, attached resolutions, and corrections.

**`PATCH /api/v1/orgs/:orgId/meetings/:meetingId/minutes`** — edit minutes. Requires `minutes:edit`.
Body: any subset of `{ summary, attendanceNotes }`

- Verify `status = DRAFT` → throw `MINUTES_FINALIZED` if not
- Emit: `minutes.updated`

**`POST /api/v1/orgs/:orgId/meetings/:meetingId/minutes/resolutions`** — attach resolution. Requires `minutes:edit`.
Body: `{ voteId, description }`

- Verify minutes `status = DRAFT`
- Verify vote belongs to this meeting and `status = CLOSED`
- Insert resolution row

**`POST /api/v1/orgs/:orgId/meetings/:meetingId/minutes/finalize`** — finalize. Requires `minutes:finalize`.

- Verify `status = DRAFT`
- Update: `status = FINALIZED`, `finalized_at = now()`
- Emit: `minutes.finalized`

**`POST /api/v1/orgs/:orgId/meetings/:meetingId/minutes/corrections`** — append correction. Requires `minutes:edit`.
Body: `{ content }`

- Verify `status = FINALIZED` → throw `422` if still draft
- Insert correction row (timestamped, append-only — document remains locked)
- Emit: `minutes.correction_added`

**`GET /api/v1/orgs/:orgId/meetings/:meetingId/minutes/export`** — export. Requires `minutes:export`.

- Load minutes with resolutions, corrections, and meeting details
- Generate structured, human-readable document suitable for compliance
- Emit: `minutes.exported`
- Response: file stream

### Audit Events

| Event                      | Trigger                  |
| -------------------------- | ------------------------ |
| `vote.created`             | Vote created             |
| `ballot.submitted`         | Ballot submitted         |
| `vote.closed`              | Vote manually closed     |
| `minutes.created`          | Minutes document created |
| `minutes.updated`          | Minutes edited           |
| `minutes.finalized`        | Minutes finalized        |
| `minutes.correction_added` | Correction appended      |
| `minutes.exported`         | Minutes exported         |

### Phase 4 Done When

- [ ] Vote can only be created in an `IN_PROGRESS` meeting
- [ ] Eligibility snapshot is correct and immutable after vote creation
- [ ] Ballot submission blocked for ineligible members
- [ ] Duplicate ballots are rejected
- [ ] Invalid choices (not in vote's options list) are rejected
- [ ] Quorum not met → outcome = `QUORUM_NOT_MET`
- [ ] Quorum met, clear winner → `PASSED` or `FAILED`
- [ ] Quorum met, tie → `TIED`
- [ ] Meeting cannot be completed while any vote is `OPEN`
- [ ] Minutes can only be created after meeting is `COMPLETED`
- [ ] Only one minutes document per meeting — second creation attempt rejected
- [ ] Finalized minutes reject edits
- [ ] Corrections can be appended to finalized minutes without unlocking them
- [ ] Export produces a valid, complete document
- [ ] All 8 audit events confirmed

---

## Phase 5 — Audit, Hardening & Deployment

**Goal:** The audit log is queryable and exportable via API. The system is secured, documented, and ready for production deployment.

### Audit Module (2 endpoints)

**`GET /api/v1/orgs/:orgId/audit`** — query audit log. Requires `audit:view`.
Query filters: `actorId`, `event`, `entityType`, `entityId`, `from`, `to`
Cursor-paginated on `(created_at DESC, id)`.

Response: paginated audit entries — each includes actor identity, event, entity details, payload, and timestamp.

**`GET /api/v1/orgs/:orgId/audit/export`** — export audit log. Requires `audit:export`.
Same filter parameters. No pagination limit on export — returns all matching entries.
Query: `?format=csv` or `?format=pdf`
Response: file stream with appropriate `Content-Disposition` header.

### Audit Integrity Verification

Before declaring Phase 5 complete, verify all 29 audit events are wired and transactional:

| Event                      | Module  |
| -------------------------- | ------- |
| `user.registered`          | auth    |
| `user.verified`            | auth    |
| `user.login`               | auth    |
| `user.logout`              | auth    |
| `org.created`              | org     |
| `org.updated`              | org     |
| `org.archived`             | org     |
| `role.created`             | role    |
| `role.updated`             | role    |
| `role.deleted`             | role    |
| `member.invited`           | member  |
| `member.joined`            | member  |
| `member.declined`          | member  |
| `member.removed`           | member  |
| `member.role_assigned`     | member  |
| `member.role_revoked`      | member  |
| `meeting.created`          | meeting |
| `meeting.updated`          | meeting |
| `meeting.status_changed`   | meeting |
| `meeting.attendee_added`   | meeting |
| `meeting.attendee_removed` | meeting |
| `vote.created`             | vote    |
| `ballot.submitted`         | vote    |
| `vote.closed`              | vote    |
| `minutes.created`          | minutes |
| `minutes.updated`          | minutes |
| `minutes.finalized`        | minutes |
| `minutes.correction_added` | minutes |
| `minutes.exported`         | minutes |

Verify for each:

- Every `emitAudit` call uses the active transaction, never the global connection
- Every state-changing operation has a corresponding audit event

Apply database-level restriction: the application's database role has `INSERT` but not `UPDATE` or `DELETE` on `audit_logs`.

### API Documentation

All routes documented with:

- Request body shape and required/optional fields
- Response shape for success and all possible error codes
- Permission required (if any)

Total: 38 endpoints documented.

### Security Hardening

**Rate limiting** — applied to routes that are most exposed to abuse:

- `POST /auth/register` — limit per IP per time window
- `POST /auth/login` — limit per IP per time window
- `POST /auth/resend-otp` — stricter limit per IP per time window

**Security headers:**

- Content-Type sniffing prevention
- Clickjacking prevention (frame options)
- HTTPS enforcement (HSTS) in production

**Health check:** `GET /health` — no auth required; returns server status and timestamp. Used by load balancers and uptime monitors.

### Deployment

**Containerization:**

- Single container in MVP; stateless design (all session state in DB) supports horizontal scaling behind a load balancer as a future step

**Startup sequence:**

1. Validate all required environment variables → refuse to start if any are missing
2. Run database migrations (all 17 tables) → server does not boot until migrations complete
3. Start HTTP server

**Environment configuration:**

- `.env.example` documents every variable with its purpose and whether it is required or has a default
- Secrets (credentials, signing keys) have minimum length validation

### Phase 5 Done When

- [ ] Audit log query returns correctly filtered, paginated results
- [ ] All filter combinations work correctly
- [ ] CSV export produces a valid, complete flat file
- [ ] PDF export produces a valid, human-readable document
- [ ] All 29 audit events confirmed present in the log after running each flow
- [ ] Every `emitAudit` call verified to use the active transaction
- [ ] DB-level INSERT-only restriction on `audit_logs` confirmed
- [ ] API documentation covers all 38 endpoints
- [ ] Rate limiting is active on all auth routes
- [ ] Health check endpoint returns 200
- [ ] Containerized app starts cleanly from a blank environment with no prior state
- [ ] Full end-to-end flow passes: register → verify → create org → create roles → invite member → accept invite → create meeting → add attendees → open meeting → create vote → submit ballots → close vote → complete meeting → create minutes → attach resolution → finalize → export → check audit log

---

## Dependency Map

```
Phase 0 (Schema + Infrastructure)
  └── Phase 1 (Auth)
        └── Phase 2 (Org / Roles / Members)
              └── Phase 3 (Meetings)
                    └── Phase 4 (Voting + Minutes)
                          └── Phase 5 (Audit + Hardening)
```

Each phase's Done When criteria must be fully met before the next phase begins.
