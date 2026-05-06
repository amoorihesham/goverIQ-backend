# Data Model: Authentication Module

**Feature**: 002-auth-module
**Date**: 2026-05-03
**Source**: existing Phase 0 schema in [`src/db/schema/auth.ts`](../../src/db/schema/auth.ts) — **no schema changes** in this feature.

This document maps each functional requirement to the columns it reads or writes
and the state transitions it performs. Phase 0 already created all three tables
with their indexes; the auth module is purely composition.

---

## Tables in scope

### `users`

| Column          | Type        | Used in                                                                                            |
| --------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `id`            | uuid PK     | every flow — referenced by `email_verifications.user_id`, `refresh_tokens.user_id`, audit `actor_id` |
| `email`         | text UNIQUE | FR-101 (lookup + uniqueness), FR-106 (lookup parity for unknown-email)                             |
| `password_hash` | text        | FR-101 (write), FR-105 / FR-106 (verify)                                                           |
| `is_verified`   | boolean     | FR-101 (init `false`), FR-104 (set `true`), FR-105 (gate login)                                    |
| `created_at`    | timestamptz | informational only                                                                                 |
| `updated_at`    | timestamptz | bumped on `is_verified` flip                                                                       |

Indexes used: `users_email_idx` (UNIQUE on `email`) — drives every email-keyed
lookup and is the indexed-query basis for SC-102 (login p95 < 200 ms at 10k users).

### `email_verifications`

| Column         | Type        | Used in                                                  |
| -------------- | ----------- | -------------------------------------------------------- |
| `id`           | uuid PK     | internal                                                 |
| `user_id`      | uuid FK     | FR-102 (UNIQUE — one active verification per user), FR-103 / FR-104 |
| `otp_hash`     | text        | FR-102 (write SHA-256(code)), FR-104 (verify)            |
| `expires_at`   | timestamptz | FR-104 (`OTP_EXPIRED` check)                              |
| `last_sent_at` | timestamptz | FR-103 (cooldown anchor)                                 |
| `created_at`   | timestamptz | informational only                                       |

Indexes used: `email_verifications_user_idx` (UNIQUE on `user_id`) — both the
single-active-record invariant and the resend-replacement query depend on it.

### `refresh_tokens`

| Column       | Type        | Used in                                                                  |
| ------------ | ----------- | ------------------------------------------------------------------------ |
| `id`         | uuid PK     | internal                                                                 |
| `user_id`    | uuid FK     | FR-107 (write), FR-109 (theft-wide DELETE), FR-110 (logout DELETE)       |
| `token_hash` | text UNIQUE | FR-107 (write SHA-256(`<userId>.<random>`)), FR-108 / FR-109 / FR-110 (lookup) |
| `expires_at` | timestamptz | FR-109 (expiry check)                                                    |
| `created_at` | timestamptz | informational only                                                       |

Indexes used: `refresh_tokens_hash_idx` (UNIQUE on `token_hash`) for refresh and
logout lookup; `refresh_tokens_user_idx` for theft-wide cleanup.

---

## State transitions performed by this module

### `users.is_verified`

```
false  ── verify-email (FR-104) ──▶  true
```

One-way transition. No path reverts a verified user to unverified in this feature.
Audit event: `user.verified` emitted in the same transaction.

### `email_verifications` lifecycle

```
(none)  ── register (FR-101)        ──▶  ACTIVE
ACTIVE  ── resend (FR-103, FR-102)  ──▶  ACTIVE (replaced; new otp_hash + last_sent_at)
ACTIVE  ── verify-email (FR-104)    ──▶  (deleted)
```

UNIQUE on `user_id` makes "replace" an `INSERT … ON CONFLICT (user_id) DO UPDATE`
or an explicit `DELETE` + `INSERT` inside `withTx`.

### `refresh_tokens` lifecycle (per row)

```
(none)  ── login / verify-email / refresh (FR-107, FR-108)  ──▶  ACTIVE
ACTIVE  ── refresh rotation (FR-108)                         ──▶  (deleted)
ACTIVE  ── logout (FR-110)                                   ──▶  (deleted)
ACTIVE  ── theft detection (FR-109; user-wide cascade)        ──▶  (deleted, all rows for that user)
ACTIVE  ── natural expiry (FR-109)                            ──▶  (deleted on next presentation)
```

`refresh_tokens` is the only table whose rows are routinely deleted; the schema
acknowledges this with `ON DELETE CASCADE` from `users`.

---

## Audit-log writes

All four auth events write through the shared `emitAudit(tx, event)` and join the
parent transaction (FR-112). `org_id` is null on all four (Phase 0 spec
clarification).

| Audit event       | `actor_id` | `entity_type` | `entity_id` | `payload`                                          | Trigger              |
| ----------------- | ---------- | ------------- | ----------- | -------------------------------------------------- | -------------------- |
| `user.registered` | `user.id`  | `'user'`      | `user.id`   | `{ data: { email } }` (no password material)       | FR-101               |
| `user.verified`   | `user.id`  | `'user'`      | `user.id`   | `{ data: { email } }`                              | FR-104               |
| `user.login`      | `user.id`  | `'user'`      | `user.id`   | `{ data: { email } }`                              | FR-105 success path  |
| `user.logout`     | `user.id`  | `'user'`      | `user.id`   | `{ data: { sessionsRemaining: number } }`          | FR-110               |

The `audit_logs` table has `org_id` nullable per Phase 0 spec clarification — these
events use null for that column.

---

## Domain invariants enforced by the schema (re-stated)

The schema already enforces these without help from the application:

- **One active verification per user** — `email_verifications_user_idx` UNIQUE on
  `user_id` makes `PENDING_INVITE_EXISTS`-style races impossible at the DB layer.
- **Refresh-token uniqueness** — `refresh_tokens_hash_idx` UNIQUE on `token_hash`
  guards against the (cryptographically negligible) collision case at the DB layer.
- **Email uniqueness** — `users_email_idx` UNIQUE on `email`. The unverified-account
  replacement flow (FR-101) handles the verified-vs-unverified branch in the
  service layer; the constraint enforces the underlying invariant.
- **Cascade deletes on user removal** — every dependent row is `ON DELETE CASCADE`
  to `users.id`, so user-tombstone flows in later phases stay simple.
