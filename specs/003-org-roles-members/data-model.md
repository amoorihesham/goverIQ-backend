# Data Model: Organizations, Roles & Members Module

**Feature**: 003-org-roles-members
**Date**: 2026-05-07
**Source**: existing Phase 0 schema in [`src/db/schema/org.ts`](../../src/db/schema/org.ts) — **no schema changes** in this feature.

This document maps each functional requirement to the columns it reads or writes
and the state transitions it performs.

---

## Tables in scope

### `organizations`

| Column             | Type                                  | Used in                                                                                   |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`               | uuid PK                               | every org-scoped flow — FK target for `roles`, `memberships`, `invitations`, `audit_logs` |
| `name`             | text NOT NULL                         | FR-201 (write), FR-202 (uniqueness check on create/update)                                |
| `name_lower`       | text UNIQUE NOT NULL                  | FR-202 (case-insensitive uniqueness via `organizations_name_lower_idx`)                   |
| `slug`             | text UNIQUE NOT NULL                  | research §3 (auto-derived on create; immutable)                                           |
| `description`      | text                                  | FR-201 (write, optional), org update                                                      |
| `logo_url`         | text                                  | FR-201 (write, optional)                                                                  |
| `quorum_threshold` | numeric(3,2) DEFAULT 0.50             | Phase 4 (vote close) — written at org creation                                            |
| `onboarding_step`  | enum NOT NULL DEFAULT 'PENDING_ROLES' | FR-203 (middleware reads), FR-204 (advances in same tx)                                   |
| `archived_at`      | timestamptz                           | FR-213 (soft-delete; set on archive, null otherwise)                                      |
| `created_at`       | timestamptz                           | informational                                                                             |
| `updated_at`       | timestamptz                           | bumped on every write                                                                     |

**Indexes used**:

- `organizations_name_lower_idx` (UNIQUE on `name_lower`) — drives case-insensitive uniqueness check (FR-202)
- `organizations_slug_idx` (UNIQUE on `slug`) — collision resolution in slug generation (research §3)

---

### `roles`

| Column        | Type                           | Used in                                                                                       |
| ------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `id`          | uuid PK                        | FK target for `memberships.role_id`, `invitations.role_id`                                    |
| `org_id`      | uuid FK → organizations        | every role query; CASCADE delete                                                              |
| `name`        | text NOT NULL                  | FR-207 / FR-208 uniqueness check within org                                                   |
| `is_owner`    | boolean NOT NULL DEFAULT false | FR-207 (immutability gate), FR-212 (sole-owner check), Owner bypass in guard                  |
| `permissions` | text[] NOT NULL DEFAULT []     | FR-205 (returned by permissions endpoint), FR-206 (escalation check), requirePermission guard |
| `created_at`  | timestamptz                    | informational                                                                                 |
| `updated_at`  | timestamptz                    | bumped on update                                                                              |

**Indexes used**:

- `roles_org_idx` on `org_id` — list roles for an org
- `roles_org_name_unique` (UNIQUE on `(org_id, name)`) — case-sensitive uniqueness (FR-207 adds case-insensitive check in service layer; DB constraint is case-sensitive fallback)

---

### `memberships`

| Column      | Type                                                | Used in                                                                        |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`        | uuid PK                                             | route param `:memberId`                                                        |
| `user_id`   | uuid FK → users                                     | requirePermission guard (load caller's membership), FR-212 (remove / role ops) |
| `org_id`    | uuid FK → organizations                             | all member queries; CASCADE delete                                             |
| `role_id`   | uuid FK → roles (nullable, SET NULL on role delete) | FR-212 (sole-owner check), permission resolution                               |
| `joined_at` | timestamptz NOT NULL DEFAULT now()                  | member list response                                                           |

**Indexes used**:

- `memberships_user_org_unique` (UNIQUE on `(user_id, org_id)`) — one membership per user per org; upsert on invite acceptance

---

### `invitations`

| Column       | Type                            | Used in                                                                 |
| ------------ | ------------------------------- | ----------------------------------------------------------------------- |
| `id`         | uuid PK                         | internal                                                                |
| `org_id`     | uuid FK → organizations         | FR-210 (pending invite check), FR-211 (onboarding advance)              |
| `email`      | text NOT NULL                   | FR-209 (invite target), FR-211 (user lookup on accept)                  |
| `role_id`    | uuid FK → roles                 | FR-209 (target role validation), FR-211 (membership creation)           |
| `token_hash` | text UNIQUE NOT NULL            | FR-211 (accept/decline lookup)                                          |
| `status`     | enum NOT NULL DEFAULT 'PENDING' | FR-210 (`PENDING` uniqueness check), FR-211 (ACCEPTED/DECLINED updates) |
| `expires_at` | timestamptz NOT NULL            | FR-211 (expiry check on accept)                                         |
| `created_at` | timestamptz                     | informational                                                           |
| `updated_at` | timestamptz                     | bumped on status change                                                 |

**Indexes used**:

- `invitations_token_hash_idx` (UNIQUE on `token_hash`) — accept/decline lookup by token
- `invitations_org_email_idx` on `(org_id, email)` — pending invite check (FR-210)

**Note on PENDING uniqueness**: The schema uses a regular index (not a partial unique
index) on `(org_id, email)`. The uniqueness of one PENDING invite per (org, email) is
enforced in the service layer by querying for existing PENDING invites before insert.
The `token_hash` UNIQUE constraint prevents token collision at the DB layer.

---

## State Transitions

### `organizations.onboarding_step`

```
PENDING_ROLES ──── first non-Owner role created (FR-204) ────▶ PENDING_INVITES
PENDING_INVITES ── invitation accepted (FR-211) ─────────────▶ COMPLETE
PENDING_INVITES ── explicit skip (research §8) ──────────────▶ COMPLETE
```

Both advances happen inside the same transaction as the triggering write.
Steps never move backwards (FR-204).

### `invitations.status`

```
PENDING ── accept token presented, valid (FR-211) ──▶ ACCEPTED
PENDING ── decline token presented (FR-211) ────────▶ DECLINED
```

`EXPIRED` status is set by a background process (out of scope for MVP) or detected
at accept time (status stays PENDING but `expires_at` check rejects the request).

### `memberships.role_id`

```
(upserted on invite accept)
role_id = invited role ── PUT /members/:id/role (FR-212) ──▶ role_id = new role
role_id = any ──────────── DELETE /members/:id/role (FR-212) ──▶ role_id = null
```

---

## Audit-log Writes

All 12 events write through `emitAudit(tx, event)` and join the parent transaction
(FR-215). `org_id` is non-null on all 12 (these events are org-scoped).

| Audit event            | `actor_id`       | `entity_type`    | `entity_id`     | `payload`                                                         | Trigger     |
| ---------------------- | ---------------- | ---------------- | --------------- | ----------------------------------------------------------------- | ----------- |
| `org.created`          | caller `user_id` | `'organization'` | `org.id`        | `{ data: { name, slug } }`                                        | FR-201      |
| `org.updated`          | caller `user_id` | `'organization'` | `org.id`        | `{ before: { name }, after: { name } }`                           | org update  |
| `org.archived`         | caller `user_id` | `'organization'` | `org.id`        | `{ data: { archivedAt } }`                                        | FR-213      |
| `role.created`         | caller `user_id` | `'role'`         | `role.id`       | `{ data: { name, permissions } }`                                 | FR-206      |
| `role.updated`         | caller `user_id` | `'role'`         | `role.id`       | `{ before: { name, permissions }, after: { name, permissions } }` | role update |
| `role.deleted`         | caller `user_id` | `'role'`         | `role.id`       | `{ data: { name } }`                                              | FR-208      |
| `member.invited`       | caller `user_id` | `'invitation'`   | `invitation.id` | `{ data: { email, roleId } }`                                     | FR-209      |
| `member.joined`        | new `user_id`    | `'membership'`   | `membership.id` | `{ data: { email, roleId } }`                                     | FR-211      |
| `member.declined`      | `null`           | `'invitation'`   | `invitation.id` | `{ data: { email } }`                                             | FR-211      |
| `member.removed`       | caller `user_id` | `'membership'`   | `membership.id` | `{ data: { userId, roleId } }`                                    | FR-212      |
| `member.role_assigned` | caller `user_id` | `'membership'`   | `membership.id` | `{ before: { roleId }, after: { roleId } }`                       | FR-212      |
| `member.role_revoked`  | caller `user_id` | `'membership'`   | `membership.id` | `{ before: { roleId }, after: { roleId: null } }`                 | FR-212      |

---

## Domain Invariants Enforced by Schema

- **Org name uniqueness** — `organizations_name_lower_idx` UNIQUE on `name_lower`
  enforces case-insensitive uniqueness at the DB layer (service layer normalises to
  lowercase before writing).
- **Slug uniqueness** — `organizations_slug_idx` UNIQUE on `slug`.
- **One membership per (user, org)** — `memberships_user_org_unique` UNIQUE on
  `(user_id, org_id)`. Invite acceptance uses INSERT … ON CONFLICT DO UPDATE (upsert)
  to handle the re-invite case.
- **Role name uniqueness within org** — `roles_org_name_unique` UNIQUE on
  `(org_id, name)` (case-sensitive at DB level; service layer also checks
  case-insensitive before insert).
- **Token hash uniqueness** — `invitations_token_hash_idx` UNIQUE on `token_hash`
  makes token collision a DB-level impossibility.
- **Cascade deletes** — deleting an org cascades to roles, memberships, invitations.
  Deleting a user cascades memberships. Deleting a role sets `memberships.role_id`
  to NULL (SET NULL) rather than deleting memberships — preserves membership history.
