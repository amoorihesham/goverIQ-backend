# Phase 0 Research: Authentication Module

**Feature**: 002-auth-module
**Date**: 2026-05-03

This document resolves the open technical decisions for the auth module. Each section
follows the **Decision / Rationale / Alternatives** format. Numeric constants live in
`src/modules/auth/constants.ts` so they can be re-tuned without touching business
logic.

---

## 1. Refresh-Token Cleartext Format & Theft-Detection Encoding

**Decision**: Refresh-token cleartext = `<userId>.<32-byte hex random>`. The full
cleartext is what the cookie carries. Storage is `SHA-256(cleartext)` in
`refresh_tokens.token_hash`; `refresh_tokens.user_id` is its own column already.

**Refresh flow**:

1. Read signed cookie `refresh_token`. Reject `UNAUTHORIZED` if missing or signature
   invalid (FR-109 last clause).
2. Compute `SHA-256(cleartext)`.
3. `SELECT … FROM refresh_tokens WHERE token_hash = ?`.
   - **Hit, not expired**: rotate inside `withTx` — DELETE this row, INSERT a new row
     with a fresh `<userId>.<random>` cleartext, set the new cookie, sign and return a
     new access JWT.
   - **Hit, expired**: DELETE this row, return `UNAUTHORIZED`. No theft cleanup.
   - **Miss**: parse `userId` from the front of the cleartext. If parse fails →
     `UNAUTHORIZED` only. If parse succeeds → DELETE every row for that user, return
     `UNAUTHORIZED` (FR-109 first clause; SC-103).

**Rationale**: The Phase 1 spec explicitly forbids schema changes (Assumption: "the
existing data schema … is sufficient"). To honor FR-109 ("delete every long-lived
credential record for the affected user"), the cleartext must self-identify the user;
a hash-only lookup cannot recover identity from a miss. Embedding `user_id` in the
cleartext is the standard approach and is safe because the security boundary is the
cookie's signature plus the random suffix's entropy (256 bits).

**Alternatives considered**:

- **Rotated-tombstone column**: add `rotated_at` to `refresh_tokens` and never delete
  rows; a presented token whose row has `rotated_at != NULL` is the theft signal.
  Rejected because it requires a schema change (out of scope) and grows the table
  unboundedly.
- **JWT-as-refresh-token with `jti`**: more moving parts, larger cookies, requires a
  blocklist anyway to defeat replay — no benefit over the opaque-token model.

---

## 2. Cookie Attributes

**Decision**: Cookie name `refresh_token`. Attributes:
`{ httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'lax', path: '/', signed: true, maxAge: REFRESH_TTL_SECONDS }`.
Signing key is the new env var `COOKIE_SECRET` (Zod `min(32)`) loaded by
`@fastify/cookie`.

**Rationale**:

- `httpOnly` — script cannot read the cookie (defense against XSS exfiltration).
- `secure` is environment-conditional: dev runs on plain HTTP; production must be HTTPS.
- `sameSite=lax` — auth flows are top-level navigations / form posts, not
  cross-origin XHR; `lax` blocks CSRF on mutating cross-site requests while still
  permitting the legitimate first-party flow. `strict` would break post-redirect
  login UIs.
- `signed: true` — `@fastify/cookie` HMAC-signs the cookie body with `COOKIE_SECRET`;
  tampered cookies are rejected before we even hash the value, saving DB round-trips.
- `path: '/'` — single-tenant cookie; subdomain isolation is out of scope for the MVP
  (per spec Assumption).

**Alternatives considered**:

- `__Host-` cookie prefix (forces `secure` + `path=/` + no `domain`): cleaner
  guarantee but adds friction in dev (HTTP), and we already enforce those attributes
  explicitly. Defer to a Phase 5 hardening pass.
- `sameSite=strict`: too restrictive — blocks the post-verify-email redirect flow if
  the client navigates from the email link.

---

## 3. Password Cost Factor

**Decision**: bcrypt `costFactor = 11`. Stored in
`src/modules/auth/constants.ts` as `PASSWORD_COST_FACTOR = 11`.

**Rationale**: At cost 11, bcrypt-verify takes ≈ 125 ms on commodity hardware
(2 GHz x86_64). Login total ≈ 150 ms (bcrypt + indexed `users_email_idx` lookup +
JWT signing + envelope serialization), comfortably under the 200 ms p95 budget
imposed by Constitution IV. Cost 12 (≈ 250 ms) would breach the budget on a single
operation. Cost 11 still requires 2,048 Blowfish key-schedule iterations per attempt
and remains within the OWASP 2024 Password Storage Cheat Sheet's acceptable range
for systems without per-hash pepper.

**Alternatives considered**:

- **Cost 12** with a perf-budget exemption in Complexity Tracking — rejected because
  the budget exists for a reason and login is on the hot path of every session
  (re-login after refresh expiry).
- **argon2id** — superior algorithm but the project's installed dep is `bcryptjs`;
  swapping to `argon2` adds a native build step and is out of scope here. Reconsider
  in Phase 5 hardening.
- **Cost 10** — too low; would put us behind 2024 OWASP guidance for systems without
  MFA.

---

## 4. OTP Scheme

**Decision**: 6-digit numeric verification code. Generated via
`crypto.randomInt(0, 1_000_000)` then zero-padded to 6 chars. Stored as
`SHA-256(code)` in `email_verifications.otp_hash`. Expiry: **10 minutes** from issue.
Resend cooldown: **60 seconds** measured from `email_verifications.last_sent_at`. At
most one active row per user enforced by the existing
`email_verifications_user_idx` UNIQUE constraint on `user_id`.

**Rationale**: 6-digit numeric is the universal industry standard (Google,
GitHub, Microsoft) — fits comfortably in an SMS or email subject line, easy to type,
and 1-in-a-million guess probability is well within the "not-realistically-brute-
forceable inside the 10-minute window without rate-limit" bar. Hashing with SHA-256
without a salt is acceptable here because the OTP is single-use, short-lived, and
bound to a single user — even an offline rainbow attack gains nothing because the
code expires before the attacker can use it. The 60-second cooldown is the minimum
that defeats casual abuse without frustrating users who genuinely didn't receive
the email.

**Alternatives considered**:

- **8-digit OTP** — 100× larger guess space but lower UX; not justified given
  10-minute expiry already provides ample protection.
- **bcrypt-hashed OTP** — overkill (and slow): the OTP's security comes from
  short-lived single use, not from being expensive to verify offline.
- **TOTP (RFC 6238)** — designed for repeated use with a shared secret; wrong tool
  for first-time email-ownership proof.

---

## 5. Test Fixture Repair

**Decision**: Fix `tests/integration/helpers/db.ts` so the `useDb()` fixture actually
holds an open transaction across the lifetime of a test and rolls back in
`afterEach`. The repair pattern:

```ts
let release: (() => void) | null = null;
let rejectTx: ((err: Error) => void) | null = null;

beforeEach(async () => {
  await new Promise<void>((readyResolve) => {
    getDatabaseClient()
      .transaction(async (tx) => {
        currentTx = tx;
        readyResolve(); // unblock the test
        await new Promise<void>((_, reject) => {
          rejectTx = reject;
        });
      })
      .catch(() => {
        /* expected — we throw to roll back */
      });
  });
});

afterEach(async () => {
  rejectTx?.(new Error('rollback')); // forces the transaction to abort
  currentTx = null;
});
```

**Rationale**: The current implementation `db.transaction(async (tx) => tx)` returns
the tx object, which causes Drizzle to commit the transaction immediately (the
callback resolved successfully). All subsequent `currentTx.insert(...)` calls in the
test execute on a stale, already-committed transaction handle. Two integration tests
authored in the auth module would silently leak data into the dev/test database —
the audit-rollback test (SC-105) cannot work at all with the current fixture. The
fix is ~15 lines and unblocks every later phase's integration tests too.

**Alternatives considered**:

- **Bypass `useDb()` and use `withTx` per test** — each test wraps its body in
  `withTx`, then throws at the end to roll back. Workable, but every test becomes
  noisy and the rollback-on-throw idiom is fragile (a thrown assertion error is
  indistinguishable from an intentional rollback).
- **`TRUNCATE` after each test** — slow (every test pays the cost of clearing 17
  tables), races against parallel tests, and doesn't help with the audit-rollback
  semantics test.

---

## 6. Identity Pre-Handler API Surface

**Decision**: Export `identityRequired` from `src/shared/auth/identity.ts` as a
Fastify pre-handler:

```ts
export const identityRequired: preHandlerHookHandler = async (request) => {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
  const token = header.slice('Bearer '.length);
  const payload = await verifyAccessToken(token); // re-uses Phase 0 helper
  request.user = { userId: payload.sub, email: payload.email };
};
```

`request.user` is typed via a module-augmentation in `src/types/fastify.d.ts`:

```ts
declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; email: string };
  }
}
```

**Error mapping** (FR-111): missing or no-`Bearer-` header → `AppError.unauthorized()`
(`UNAUTHORIZED`); malformed JWT (signature fails / claims wrong) →
`AppError.invalidToken()` (`INVALID_TOKEN`); expired JWT →
`AppError.tokenExpired()` (`TOKEN_EXPIRED`). The existing `verifyAccessToken` already
throws the latter two correctly.

**Rationale**: Plain async pre-handler beats decorator-style for testability — it's a
pure function `(FastifyRequest) → Promise<void>` that mutates request state. Every
later phase's protected route adds it as `preHandler: [identityRequired]`. Type
augmentation gives compile-time safety on `request.user.userId` without scattering
non-null assertions.

**Alternatives considered**:

- **Fastify decorator** (`fastify.decorate('user', ...)`) — global, less explicit
  about which routes are actually protected.
- **Plugin that registers the pre-handler globally** — too aggressive; the auth
  routes themselves must NOT have `identityRequired` (login / register / refresh /
  logout are by definition unauthenticated entry points).

---

## Numeric constants summary

All values live in `src/modules/auth/constants.ts`:

| Constant                  | Value             | Source                |
| ------------------------- | ----------------- | --------------------- |
| `PASSWORD_MIN_LENGTH`     | 12                | spec clarification Q1 |
| `PASSWORD_COST_FACTOR`    | 11                | research §3           |
| `OTP_LENGTH`              | 6                 | research §4           |
| `OTP_TTL_MINUTES`         | 10                | research §4           |
| `OTP_RESEND_COOLDOWN_SEC` | 60                | research §4           |
| `ACCESS_TTL_SECONDS`      | 900 (15 min)      | master plan Phase 1   |
| `REFRESH_TTL_SECONDS`     | 604_800 (7 days)  | master plan Phase 1   |
| `REFRESH_COOKIE_NAME`     | `'refresh_token'` | research §2           |
| `REFRESH_RANDOM_BYTES`    | 32                | research §1           |
