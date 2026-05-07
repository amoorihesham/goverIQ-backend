# Quickstart: Auth Module Verification

**Feature**: 002-auth-module
**Audience**: Developers verifying that the auth module behaves correctly end-to-end.

This walkthrough exercises every functional requirement and every success criterion
from [spec.md](./spec.md). After completing it against a fresh local environment,
the auth module's "Done When" criteria from
[docs/IMPLEMENTATION-PLAN.md](../../docs/IMPLEMENTATION-PLAN.md) Phase 1 should be
visibly satisfied.

---

## 0. Prerequisites

- Phase 0 quickstart completed at least once (Postgres + Mailpit running locally).
- `.env` includes `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars), `SMTP_FROM`,
  **`COOKIE_SECRET`** (≥ 32 chars — new for this feature).
- `pnpm install` has run since `@fastify/cookie` was added.
- `pnpm db:migrate` (no-op if already at head — schema is unchanged).

Start the server:

```bash
pnpm dev
```

The console should report startup with no missing-env errors (FR-113).

---

## 1. Register a new user (FR-101 / FR-102; SC-101)

```bash
curl -i -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
```

Expected: `201 Created`, body `{ "success": true, "data": { "message": "Verification email sent." } }`.

Verify in Mailpit at `http://localhost:8025` that an email titled "Verify your
GovernIQ email" arrived containing a 6-digit code.

**Audit check**:

```bash
psql "$DATABASE_URL" -c "SELECT event, payload FROM audit_logs ORDER BY created_at DESC LIMIT 1;"
```

Expected: one row with `event = 'user.registered'` and `payload->>'data' = '{"email":"alice@example.com"}'`.

---

## 2. Submit the OTP (FR-104; US1 acceptance #2)

Take the 6-digit code from the email and submit it:

```bash
curl -i -X POST http://localhost:3000/auth/verify-email \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","otp":"123456"}'
```

Expected: `200 OK`, response body contains `accessToken` (a JWT), and a
`Set-Cookie: refresh_token=...; HttpOnly; SameSite=Lax; Path=/; ...` header.

**Audit check**: a new `user.verified` row exists in `audit_logs`.
**DB check**: the `email_verifications` row for this user is gone.

Save the access token:

```bash
ACCESS_TOKEN="<paste from response>"
```

Save the cookie (cURL's `-c cookies.txt` does this automatically; the `-b` flag
will replay it later).

---

## 3. Use the access token against a protected route (FR-111)

The auth module ships no protected routes itself, but the `identityRequired`
pre-handler can be exercised by attaching it to any test endpoint. For now,
verify the token directly:

```bash
node -e 'import("jose").then(j => j.jwtVerify(process.argv[1], new TextEncoder().encode(process.env.JWT_SECRET))).then(r => console.log(r.payload))' "$ACCESS_TOKEN"
```

Expected: `{ sub: '<uuid>', email: 'alice@example.com', iat: ..., exp: ... }`
where `exp - iat === 900` (15 min).

---

## 4. Wrong-password / unknown-email parity (FR-106; SC-106)

```bash
# Wrong password
curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"obviously-wrong-pw"}' | tee /tmp/wrong-pw.json

# Unknown email
curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@example.com","password":"obviously-wrong-pw"}' | tee /tmp/unknown.json

diff /tmp/wrong-pw.json /tmp/unknown.json
```

Expected: `diff` reports no difference. Both responses are
`{ "success": false, "error": { "code": "INVALID_CREDENTIALS", ... } }` with status 401.

---

## 5. Login (FR-105 / FR-107; US2 acceptance #1)

```bash
curl -i -X POST http://localhost:3000/auth/login \
  -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
```

Expected: `200 OK`, JSON body with a fresh `accessToken`, `Set-Cookie` with a new
`refresh_token` value. A `user.login` audit row is appended.

---

## 6. Refresh rotation (FR-108)

```bash
curl -i -X POST http://localhost:3000/auth/refresh \
  -b cookies.txt -c cookies.txt
```

Expected: `200 OK`, new `accessToken`, new `Set-Cookie` (different value).
`refresh_tokens` table now holds the **new** row only — the previous row was
DELETEd inside the same transaction.

---

## 7. Theft detection (FR-109; SC-103) — the security-critical test

Save the **previous** cookie value before step 6 (call it `OLD_COOKIE`). Re-play it:

```bash
curl -i -X POST http://localhost:3000/auth/refresh \
  -H "Cookie: refresh_token=$OLD_COOKIE"
```

Expected: `401 Unauthorized`, response body `{ "success": false, "error": { "code": "UNAUTHORIZED", ... } }`,
`Set-Cookie` clearing the cookie.

**DB check**: `SELECT count(*) FROM refresh_tokens WHERE user_id = '<alice's uuid>';`
should return `0` — every active session for this user has been invalidated.

The current `cookies.txt` (from step 6) is also now useless:

```bash
curl -i -X POST http://localhost:3000/auth/refresh -b cookies.txt
```

Expected: `401 Unauthorized` (its row was wiped by the theft cascade).

---

## 8. Resend cooldown (FR-103; US4)

Re-register a different user, then immediately request a resend:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"bob@example.com","password":"correct-horse-battery"}'
curl -i -X POST http://localhost:3000/auth/resend-otp \
  -H 'content-type: application/json' \
  -d '{"email":"bob@example.com"}'
```

Expected: second call returns `422 Unprocessable Entity`, `OTP_COOLDOWN`. Wait

> 60 s and retry — second call now succeeds with `200 OK` and a fresh email.

Enumeration parity check:

```bash
curl -i -X POST http://localhost:3000/auth/resend-otp \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@example.com"}'
```

Expected: same `422 / OTP_COOLDOWN` response shape — no leak that the email is
unknown.

---

## 9. Re-register an unverified email (FR-101 — clarification Q3)

Register `charlie@example.com`, do **not** verify, then register again with the
same email:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"charlie@example.com","password":"first-password-x"}'
curl -i -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"charlie@example.com","password":"second-password-y"}'
```

Expected: both calls return `201`. The DB row for `charlie@example.com` now has
the **second** password hash and a **new** `email_verifications` row.

Now verify `alice@example.com` (a verified user) — re-registration **must** be
rejected:

```bash
curl -i -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"any-password-12chr"}'
```

Expected: `409 Conflict`, `DUPLICATE_EMAIL`.

---

## 10. Logout idempotency (FR-110; SC-107)

Log alice in afresh:

```bash
curl -X POST http://localhost:3000/auth/login \
  -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}' >/dev/null
```

Sign out — twice:

```bash
curl -i -X POST http://localhost:3000/auth/logout -b cookies.txt -c cookies.txt
curl -i -X POST http://localhost:3000/auth/logout -b cookies.txt -c cookies.txt
```

Expected: both calls return `204 No Content`, both clear the cookie. No error
on the second call. A `user.logout` audit row is appended for the first call only.

---

## 11. Audit-rollback invariant (FR-112; SC-105)

Run the integration test that wraps a `register` call in a transaction that
forcibly rolls back:

```bash
pnpm test tests/integration/modules/auth/register.test.ts -t 'audit rolls back'
```

Expected: test passes; after the rollback there are zero `user.registered` rows
matching the test's email.

---

## 12. Coverage gate (Constitution II)

```bash
pnpm test:coverage
```

Expected: line + branch coverage ≥ 80%; `auth` module specifically reports ≥ 80%.

---

## Done-When mapping

| Phase 1 "Done When" bullet                                                            | Verified by step            |
| ------------------------------------------------------------------------------------- | --------------------------- |
| Registration creates an unverified user and triggers a notification                   | 1                           |
| OTP verification marks user verified and issues a valid session                       | 2, 3                        |
| OTP expiry is enforced — expired OTPs are rejected                                    | (integration test)          |
| OTP resend cooldown is enforced                                                       | 8                           |
| Login is blocked for unverified users                                                 | (integration test — SC-104) |
| Refresh rotates the cookie and issues a new access credential                         | 6                           |
| Refresh token reuse returns `UNAUTHORIZED` and invalidates all sessions for that user | 7                           |
| Logout deletes the token row and clears the cookie                                    | 10                          |
| Identity preHandler rejects requests with missing or expired access credentials       | 3 + integration test        |
| All 4 audit events confirmed in the log after running each flow                       | 1, 2, 5, 10                 |
