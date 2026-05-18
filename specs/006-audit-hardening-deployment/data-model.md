# Data Model: Audit, Hardening & Deployment

**Feature**: 006-audit-hardening-deployment
**Date**: 2026-05-18

This feature **creates no new table and alters no existing column**. It reads
the `audit_logs` table delivered in feature 001, adds one **additive migration**
that installs a database trigger, and defines a small number of in-code
structures (a redaction deny-list, an event registry, response shapes). This
document maps what is read, what the one migration changes, and the shapes the
audit query/export return.

---

## 1. `audit_logs` — read-only source table (unchanged)

Delivered in feature 001; this feature only reads it. Columns
(`src/db/schema/audit.ts`):

| Column        | Type          | Notes                                            |
| ------------- | ------------- | ------------------------------------------------ |
| `id`          | `uuid` PK     | `defaultRandom()` — keyset tiebreaker            |
| `org_id`      | `uuid` null   | Scoping column for every query/export            |
| `actor_id`    | `uuid` null   | Acting user; `actorId` filter                    |
| `event`       | `text` NN     | e.g. `org.created`; free-form `event` filter     |
| `entity_type` | `text` NN     | e.g. `organization`; `entityType` filter         |
| `entity_id`   | `uuid` null   | `entityId` filter (valid without `entityType`)   |
| `payload`     | `jsonb` NN    | `{before,after}` or `{data}`; redacted on read   |
| `created_at`  | `timestamp` NN| `defaultNow()`; sort key + `from`/`to` filter    |

**Indexes (feature 001, reused — no new index):**

- `audit_logs_org_created_idx` — `(org_id, created_at DESC)` — keyset paging
- `audit_logs_org_actor_idx` — `(org_id, actor_id)` — `actorId` filter
- `audit_logs_org_event_idx` — `(org_id, event)` — `event` filter
- `audit_logs_org_entity_idx` — `(org_id, entity_type, entity_id)` — entity filters

Every filter column is index-backed; Postgres bitmap-combines indexes for
multi-filter queries. No N+1 path (Constitution IV).

---

## 2. Migration `0004_audit_append_only.sql` (the only schema change)

Additive, non-destructive — installs an append-only guard on `audit_logs`. No
column, type, or index is changed.

```sql
-- Reject any UPDATE or DELETE on audit_logs at the data-store level.
CREATE OR REPLACE FUNCTION audit_logs_append_only()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- Defence in depth (the trigger is the primary guard; see research Decision 4).
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
```

The trigger fires for **every** role, including the table owner — this is what
makes the guarantee hold against the application's own credentials (FR-507).
`INSERT` is untouched, so `emitAudit(tx, …)` continues to write inside the
transaction of the operation it describes (FR-509). Generated/added under
`src/db/migrations/0004_audit_append_only.sql`; applied by the standard startup
migration step (`runMigrations`).

---

## 3. Redaction deny-list (in code — `src/shared/audit/redact.ts`)

A frozen constant, not a table. Field names removed from a payload before any
query or export returns it (FR-504a). The **stored row is never modified**.

```ts
export const AUDIT_REDACTION_DENYLIST = Object.freeze([
  'passwordHash',
  'password',
  'otpHash',
  'tokenHash',
  'refreshTokenHash',
  'refreshTokenCleartext',
  'accessToken',
  'inviteTokenHash',
] as const);

// Pure: deep-walks {before,after} / {data}, drops any deny-listed key,
// returns a new object. Used identically by the query and export paths.
export function redactAuditPayload(payload: unknown): unknown;
```

Parity rule: query and export both call `redactAuditPayload` — for any filter
set they return byte-identical redacted payloads (FR-504a, SC-504a).

---

## 4. Audit-event registry (in code — `src/shared/audit/events.ts`)

Canonical set of the **29** emitted event types; used to type-check every
`emitAudit` call and to verify completeness (FR-508, SC-501).

```ts
export const AUDIT_EVENTS = Object.freeze([
  'user.registered', 'user.verified', 'user.login', 'user.logout',
  'org.created', 'org.updated', 'org.archived', 'org.onboarding_skipped',
  'role.created', 'role.updated', 'role.deleted',
  'member.role_assigned', 'member.role_revoked', 'member.removed',
  'invitation.created',
  'meeting.created', 'meeting.updated', 'meeting.status_changed',
  'meeting.attendee_added', 'meeting.attendee_removed',
  'vote.created', 'vote.closed', 'ballot.submitted',
  'minutes.created', 'minutes.updated', 'minutes.finalized',
  'minutes.correction_added', 'minutes.exported',
  'system.cleanup',
] as const);

export type AuditEventName = (typeof AUDIT_EVENTS)[number];
```

`src/shared/audit/types.ts` — `AuditEvent.event` is retyped from `string` to
`AuditEventName`, so a typo or omitted event fails compilation.

---

## 5. Audit query — request & response shapes

**`GET /api/v1/audit/org/:orgId`** — requires `audit:view`.

Query parameters (all optional, AND-combined):

| Param        | Type            | Notes                                           |
| ------------ | --------------- | ----------------------------------------------- |
| `actorId`    | uuid            | Exact match on `actor_id`                       |
| `event`      | string          | Exact match on `event` (free-form, no enum)     |
| `entityType` | string          | Exact match on `entity_type`                    |
| `entityId`   | uuid            | Exact match on `entity_id`; valid alone         |
| `from`       | ISO-8601 UTC    | Inclusive lower bound on `created_at`           |
| `to`         | ISO-8601 UTC    | Inclusive upper bound on `created_at`           |
| `cursor`     | opaque string   | Keyset cursor; invalid/foreign → `VALIDATION_ERROR` |
| `limit`      | int 1–100       | Default 20                                      |

Response `200` — standard success envelope:

```jsonc
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "uuid",
        "actorId": "uuid | null",
        "event": "org.created",
        "entityType": "organization",
        "entityId": "uuid | null",
        "payload": { /* {before,after} or {data} — redacted */ },
        "createdAt": "2026-05-18T10:00:00.000Z"
      }
    ],
    "nextCursor": "opaque-string | null"
  }
}
```

`from > to` → `entries: []`, `nextCursor: null` (edge case, not an error).
A caller without `audit:view` → `FORBIDDEN` (handled by `requirePermission`).

## 6. Audit export — request & response

**`GET /api/v1/audit/org/:orgId/export`** — requires `audit:export`.

Same filter parameters as the query **minus `cursor` and `limit`** (export is
unbounded). Plus:

| Param    | Type               | Notes                                  |
| -------- | ------------------ | -------------------------------------- |
| `format` | `csv` \| `pdf`     | Default `csv`; any other → `VALIDATION_ERROR` |

Response `200` — a **file stream**, bypassing the JSON envelope:

- `Content-Type`: `text/csv` or `application/pdf`
- `Content-Disposition`: `attachment; filename="audit-<orgId>-<ISO>.csv|pdf"`
- Body: every entry matching the filters across the whole result set, redacted,
  in the same `(created_at DESC, id)` order the query returns (FR-506). A
  zero-match filter set still produces a well-formed file — CSV with only its
  header row, PDF with structure and no data rows (edge case, SC-504).

---

## 7. Organization scoping (FR-503) — invariant

Every query and every export `WHERE` clause is hard-anchored to
`audit_logs.org_id = :orgId`, where `:orgId` is the path segment validated by
`attachOrgId` + `requirePermission` (which confirms the caller is a member of
that org). No filter value and no cursor can widen the scope: a cursor decoded
from another org's page still ANDs against this org's `org_id`, so it can never
surface a foreign row. Reading the audit log is **not itself audited** — there
is no `audit.viewed` / `audit.exported` event, consistent with the fixed
29-event registry.

---

## 8. State & lifecycle

`audit_logs` rows have **no mutable state** — they are write-once and, after
migration `0004`, the database itself rejects any `UPDATE`/`DELETE`. There is no
state machine, no archival, no purge (entries are retained indefinitely,
consistent with the no-hard-delete principle). This feature adds **no** new
audit events: the query and export endpoints are deliberately silent in the
audit trail.
