# Data Model: Meetings Module

**Feature**: 004-meetings
**Date**: 2026-05-16
**Source**: existing Phase 0 schema in [`src/db/schema/meeting.ts`](../../src/db/schema/meeting.ts) — **no schema changes** in this feature.

This document maps each functional requirement to the columns it reads or writes
and the state transitions it performs.

---

## Tables in scope

### `meetings`

| Column         | Type                               | Used in                                                                  |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `id`           | uuid PK                            | route param `:meetingId`; FK target for agenda items, attendees, votes   |
| `org_id`       | uuid FK → organizations (CASCADE)  | every meeting query; org-scoping; permission/onboarding resolution       |
| `title`        | text NOT NULL                      | FR-301/FR-302 (write), FR-310 (update)                                   |
| `description`  | text                               | FR-302 (write, optional), FR-310 (update)                                |
| `location`     | text                               | FR-302 (write, optional), FR-310 (update)                                |
| `scheduled_at` | timestamptz NOT NULL               | FR-302 (write), FR-305 (15-min guard), FR-317 (future check)             |
| `status`       | enum NOT NULL DEFAULT 'DRAFT'      | FR-301 (starts `DRAFT`), FR-304..307 (transitions), FR-310 (edit window) |
| `created_at`   | timestamptz NOT NULL DEFAULT now() | informational                                                            |
| `updated_at`   | timestamptz NOT NULL DEFAULT now() | bumped on every write                                                    |

**`meeting_status` enum**: `DRAFT`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`,
`CANCELLED`.

**Indexes used**:

- `meetings_org_status_idx` on `(org_id, status)` — list with `status` filter
  and keyset pagination (FR-311)
- `meetings_scheduled_at_idx` on `scheduled_at` — `from` / `to` range filter
  (FR-311)

---

### `meeting_agenda_items`

| Column        | Type                         | Used in                                            |
| ------------- | ---------------------------- | -------------------------------------------------- |
| `id`          | uuid PK                      | internal                                           |
| `meeting_id`  | uuid FK → meetings (CASCADE) | FR-301 (insert), FR-310 (replace), FR-312 (detail) |
| `title`       | text NOT NULL                | FR-303 (write)                                     |
| `description` | text                         | FR-303 (write, optional)                           |
| `order_index` | integer NOT NULL             | FR-303 (ordering; uniqueness within meeting)       |
| `created_at`  | timestamptz NOT NULL         | informational                                      |
| `updated_at`  | timestamptz NOT NULL         | informational                                      |

**Indexes used**:

- `meeting_agenda_items_meeting_order_unique` UNIQUE on `(meeting_id, order_index)`
  — rejects duplicate order positions at the DB layer (FR-303)

A meeting MAY have zero agenda items (FR-301, spec clarification).

---

### `meeting_attendees`

| Column       | Type                            | Used in                                          |
| ------------ | ------------------------------- | ------------------------------------------------ |
| `meeting_id` | uuid FK → meetings (CASCADE)    | FR-308/FR-309 (add/remove), FR-305 (count guard) |
| `member_id`  | uuid FK → memberships (CASCADE) | FR-308 (membership validation), FR-309 (remove)  |
| `created_at` | timestamptz NOT NULL            | informational                                    |
| `updated_at` | timestamptz NOT NULL            | informational                                    |

**Indexes used**:

- `meeting_attendees_pkey` UNIQUE on `(meeting_id, member_id)` — composite key;
  drives idempotent `ON CONFLICT DO NOTHING` add (FR-308) and the attendee count
  guard (FR-305)

**Cascade behavior**: `member_id → memberships.id` is `onDelete: 'cascade'` —
removing a member from an org auto-removes their attendee rows (research §11).

---

### `votes` (read-only in this feature)

The `IN_PROGRESS → COMPLETED` guard (FR-306) reads `votes` only:

| Column       | Type                     | Used in                 |
| ------------ | ------------------------ | ----------------------- |
| `meeting_id` | uuid FK → meetings       | open-votes guard filter |
| `status`     | enum (`OPEN` / `CLOSED`) | open-votes guard filter |

**Index used**: `votes_meeting_status_idx` on `(meeting_id, status)`. No vote
rows exist until Phase 4, so the guard count is currently always 0.

---

## State Transitions

### `meetings.status`

```
DRAFT ──▶ SCHEDULED ──▶ IN_PROGRESS ──▶ COMPLETED
                │              │
                ▼              ▼
            CANCELLED      CANCELLED
```

| From                                                           | To            | Permission       | Guard                                         |
| -------------------------------------------------------------- | ------------- | ---------------- | --------------------------------------------- |
| `DRAFT`                                                        | `SCHEDULED`   | `meeting:update` | none                                          |
| `SCHEDULED`                                                    | `IN_PROGRESS` | `meeting:update` | ≥ 1 attendee AND `now ≥ scheduledAt − 15 min` |
| `SCHEDULED`                                                    | `CANCELLED`   | `meeting:cancel` | none                                          |
| `IN_PROGRESS`                                                  | `COMPLETED`   | `meeting:update` | no `OPEN` vote attached to the meeting        |
| `IN_PROGRESS`                                                  | `CANCELLED`   | `meeting:cancel` | none                                          |
| any other pair (incl. repeats, out of `COMPLETED`/`CANCELLED`) | —             | —                | rejected → `INVALID_STATE_TRANSITION`         |

Guard failures: time window → `MEETING_TOO_EARLY`; zero attendees →
`INVALID_STATE_TRANSITION`; open votes → `MEETING_HAS_OPEN_VOTES`. `COMPLETED`
and `CANCELLED` are terminal — `MEETING_TRANSITIONS` maps both to `[]`.

### Edit window (`meetings` detail / agenda — FR-310)

```
status ∈ { DRAFT, SCHEDULED }      → edit permitted
status ∈ { IN_PROGRESS, COMPLETED, CANCELLED } → edit rejected → INVALID_STATE_TRANSITION
```

### Attendee mutation window (FR-308 / FR-309 — spec clarification)

```
status ∈ { DRAFT, SCHEDULED, IN_PROGRESS } → add/remove permitted
status ∈ { COMPLETED, CANCELLED }          → add/remove rejected → INVALID_STATE_TRANSITION
```

---

## Validation Rules

| Rule                                                        | Enforced by                                | FR         |
| ----------------------------------------------------------- | ------------------------------------------ | ---------- |
| `title` present, `scheduledAt` present                      | Zod create schema                          | FR-302     |
| `scheduledAt` strictly in the future (create and update)    | Zod `.refine()` → `VALIDATION_ERROR`       | FR-317     |
| Agenda `order_index` unique within a meeting                | `meeting_agenda_items` unique index        | FR-303     |
| Agenda items optional at creation                           | Zod create schema (`agendaItems` optional) | FR-301     |
| Every attendee id is a current org membership               | service query before insert                | FR-308     |
| Transition allowed by the map                               | `assertValidTransition` (pure)             | FR-304     |
| Open meeting only within window with ≥ 1 attendee           | service guard inside `withTx`              | FR-305     |
| Complete meeting only with no open votes                    | service guard inside `withTx`              | FR-306     |
| Edits only in `DRAFT` / `SCHEDULED`                         | service status check                       | FR-310     |
| Attendee mutation only in `DRAFT`/`SCHEDULED`/`IN_PROGRESS` | service status check                       | FR-308/309 |

---

## Audit-log Writes

All 5 events write through `emitAudit(tx, event)` and join the originating
transaction (FR-315). `org_id` is non-null on all 5 (these events are
org-scoped).

| Audit event                | `actor_id`       | `entity_type` | `entity_id`  | `payload`                                       | Trigger |
| -------------------------- | ---------------- | ------------- | ------------ | ----------------------------------------------- | ------- |
| `meeting.created`          | caller `user_id` | `'meeting'`   | `meeting.id` | `{ data: { title, scheduledAt } }`              | FR-301  |
| `meeting.updated`          | caller `user_id` | `'meeting'`   | `meeting.id` | `{ before: {...}, after: {...} }`               | FR-310  |
| `meeting.status_changed`   | caller `user_id` | `'meeting'`   | `meeting.id` | `{ before: <status>, after: <status> }`         | FR-307  |
| `meeting.attendee_added`   | caller `user_id` | `'meeting'`   | `meeting.id` | `{ data: { memberId } }` (one per added member) | FR-308  |
| `meeting.attendee_removed` | caller `user_id` | `'meeting'`   | `meeting.id` | `{ data: { memberId } }`                        | FR-309  |

---

## Domain Invariants Enforced by Schema

- **One attendee link per (meeting, member)** — `meeting_attendees_pkey` UNIQUE
  on `(meeting_id, member_id)` makes a duplicate attendee a DB-level
  impossibility; the add path uses `INSERT … ON CONFLICT DO NOTHING`.
- **Unique agenda ordering** — `meeting_agenda_items_meeting_order_unique`
  UNIQUE on `(meeting_id, order_index)` rejects duplicate positions.
- **Cascade deletes** — deleting a meeting cascades to its agenda items,
  attendees, and votes; deleting an org cascades to its meetings; deleting a
  membership cascades to that member's attendee rows.
