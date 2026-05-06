# Tasks: Authentication Module

**Input**: Design documents from `/specs/002-auth-module/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included — the plan's Constitution II gate explicitly mandates "1 unit-test file per pure helper and 1 integration-test file per route + 1 for the pre-handler; covers every FR / SC". TDD enforced.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently. The five user stories from spec.md map to the six routes plus the identity pre-handler:

| Story | Priority | Routes / artifacts                                          |
| ----- | -------- | ----------------------------------------------------------- |
| US1   | P1       | `POST /auth/register`, `POST /auth/verify-email`            |
| US2   | P1       | `POST /auth/login`                                          |
| US3   | P1       | `POST /auth/refresh`                                        |
| US4   | P2       | `POST /auth/resend-otp`                                     |
| US5   | P2       | `POST /auth/logout`                                         |

The `identityRequired` pre-handler (FR-111) is foundational shared infrastructure (used by every later phase), not story-scoped, so it lives in Phase 2.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependency on incomplete tasks → safe to run in parallel
- **[Story]**: Maps to spec.md user story (US1…US5); absent on Setup / Foundational / Polish
- File paths are absolute-from-repo-root and unambiguous

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Pull in the new runtime dependency, register cookie support, declare the new env var, fix the broken test fixture so every later integration test works.

- [X] T001 Add `@fastify/cookie` to runtime dependencies via `pnpm add @fastify/cookie` and verify the entry appears in [package.json](../../package.json) under `dependencies`
- [X] T002 [P] Add `COOKIE_SECRET: z.string().min(32)` to the env schema in [src/shared/config/env.ts](../../src/shared/config/env.ts) and add `COOKIE_SECRET=<≥32-char value>` to [.env.example](../../.env.example) and the project `.env` documentation block
- [X] T003 [P] Register `@fastify/cookie` in [src/server.ts](../../src/server.ts) with `{ secret: env.COOKIE_SECRET, hook: 'onRequest' }` ordered BEFORE any module plugins are mounted
- [X] T004 [P] Repair the broken transactional fixture in [tests/integration/helpers/db.ts](../../tests/integration/helpers/db.ts) per research.md §5 (open tx in `beforeEach`, force-reject in `afterEach` to roll back) and add a self-test that verifies a row inserted in `beforeEach` is gone after `afterEach`
- [X] T005 [P] Create [src/modules/auth/constants.ts](../../src/modules/auth/constants.ts) exporting all numeric tunables (`PASSWORD_MIN_LENGTH=12`, `PASSWORD_COST_FACTOR=11`, `OTP_LENGTH=6`, `OTP_TTL_MINUTES=10`, `OTP_RESEND_COOLDOWN_SEC=60`, `ACCESS_TTL_SECONDS=900`, `REFRESH_TTL_SECONDS=604_800`, `REFRESH_COOKIE_NAME='refresh_token'`, `REFRESH_RANDOM_BYTES=32`) per research.md §"Numeric constants summary"

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure helpers (password / tokens / otp), shared error codes, JWT signing helper, identity pre-handler, request-type augmentation, repository, and the service+routes plugin scaffold. Every user story phase imports from this layer.

**⚠️ CRITICAL**: No user-story phase can begin until this phase completes — every route handler depends on the service / repository / helpers built here.

### Pure helpers (parallelizable — different files)

- [X] T006 [P] Implement bcryptjs wrapper in [src/modules/auth/password.ts](../../src/modules/auth/password.ts) exposing `hashPassword(plain: string): Promise<string>` (uses `PASSWORD_COST_FACTOR`) and `verifyPassword(plain: string, hash: string): Promise<boolean>`
- [X] T007 [P] Implement [src/modules/auth/tokens.ts](../../src/modules/auth/tokens.ts) — `generateRefreshTokenCleartext(userId): string` (= `<userId>.<32-byte hex>`), `parseUserIdFromCleartext(cleartext): string | null`, `hashRefreshToken(cleartext): string` (SHA-256 hex) per research.md §1
- [X] T008 [P] Implement [src/modules/auth/otp.ts](../../src/modules/auth/otp.ts) — `generateOtp(): string` (`crypto.randomInt(0, 1_000_000)` zero-padded to 6 chars) and `hashOtp(code: string): string` (SHA-256 hex) per research.md §4
- [X] T009 [P] Implement [src/modules/auth/cookies.ts](../../src/modules/auth/cookies.ts) — `buildRefreshCookieAttrs(): CookieSerializeOptions` returning `{ httpOnly:true, secure: env.NODE_ENV==='production', sameSite:'lax', path:'/', signed:true, maxAge: REFRESH_TTL_SECONDS }` per research.md §2

### Pure-helper unit tests (parallelizable — different files)

- [X] T010 [P] Unit tests in [tests/unit/modules/auth/password.test.ts](../../tests/unit/modules/auth/password.test.ts) covering hash uniqueness (two hashes of same password differ — salt presence), `verifyPassword` true on match, false on mismatch, cost factor encoded in hash header
- [X] T011 [P] Unit tests in [tests/unit/modules/auth/tokens.test.ts](../../tests/unit/modules/auth/tokens.test.ts) covering `generateRefreshTokenCleartext` shape (`<uuid>.<64-hex>`), `parseUserIdFromCleartext` happy + malformed → `null`, `hashRefreshToken` deterministic + SHA-256 length
- [X] T012 [P] Unit tests in [tests/unit/modules/auth/otp.test.ts](../../tests/unit/modules/auth/otp.test.ts) covering `generateOtp` length=6, all-digits, distribution sanity (no obvious bias across 1k draws), `hashOtp` deterministic + SHA-256 length

### Shared error / type / signing additions (parallelizable — different files)

- [ ] T013 [P] Add `OTP_EXPIRED` (HTTP 422) and `OTP_COOLDOWN` (HTTP 422) entries to the error-code registry in [src/shared/errors/codes.ts](../../src/shared/errors/codes.ts) and `AppError.otpExpired()` + `AppError.otpCooldown()` static factories in [src/shared/errors/http-error.ts](../../src/shared/errors/http-error.ts)
- [ ] T014 [P] Add `signAccessToken(payload: { sub: string; email: string }): Promise<string>` to [src/shared/auth/jwt.ts](../../src/shared/auth/jwt.ts) — uses `jose`, `JWT_SECRET`, `expiresIn = ACCESS_TTL_SECONDS`. Do NOT modify `verifyAccessToken`.
- [ ] T015 [P] Augment `FastifyRequest` with `user?: { userId: string; email: string }` in [src/types/fastify.d.ts](../../src/types/fastify.d.ts) (create file if absent) and ensure `tsconfig.json` `include` covers it
- [ ] T016 [P] Implement `identityRequired` pre-handler in [src/shared/auth/identity.ts](../../src/shared/auth/identity.ts) per research.md §6 with the exact error mapping from FR-111 (missing `Bearer ` → `UNAUTHORIZED`; bad signature/claims → `INVALID_TOKEN`; expired → `TOKEN_EXPIRED`)

### Auth-module scaffold (sequential — same files)

- [ ] T017 [P] Define Zod input/output schemas for all six routes in [src/modules/auth/auth.schemas.ts](../../src/modules/auth/auth.schemas.ts), matching the request/response shapes in [contracts/](./contracts/) (register, verify-email, resend-otp, login, refresh, logout) and including `password: z.string().min(PASSWORD_MIN_LENGTH)`, `email: z.string().email()`, `otp: z.string().length(OTP_LENGTH).regex(/^\d+$/)`
- [ ] T018 Create the Drizzle repository layer in [src/modules/auth/auth.repository.ts](../../src/modules/auth/auth.repository.ts) — pure functions taking `(tx, …)` and exposing: `findUserByEmail`, `insertUser`, `updateUserVerified`, `deleteUserById`, `upsertVerification` (DELETE+INSERT replacement), `findVerificationByUserId`, `deleteVerification`, `insertRefreshToken`, `findRefreshTokenByHash`, `deleteRefreshTokenById`, `deleteAllRefreshTokensForUser`. NO business logic.
- [ ] T019 Create the service skeleton in [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — exports `createAuthService(deps)` factory returning an object with empty method stubs (`register`, `verifyEmail`, `resendOtp`, `login`, `refresh`, `logout`). Each story phase fills one stub. Include the shared private helpers `issueSessionWithinTx(tx, user)` (signs access JWT + creates refresh-token row + returns `{ accessToken, refreshCookieValue }`) and `enforceLoginParity()` (throws `AppError.invalidCredentials()` — used by login + resend-otp for enumeration parity).
- [ ] T020 Create the routes scaffold in [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) and Fastify-plugin export in [src/modules/auth/index.ts](../../src/modules/auth/index.ts). Routes file registers all six paths with empty handlers that return `501 Not Implemented` for now; each story phase wires its handler. Plugin export attaches the routes under `/auth` prefix.
- [ ] T021 Mount the auth plugin in [src/server.ts](../../src/server.ts) immediately after `@fastify/cookie` registration, ordered before any future protected modules
- [ ] T022 Integration tests for `identityRequired` (FR-111) in [tests/integration/modules/auth/identity.test.ts](../../tests/integration/modules/auth/identity.test.ts) using a throwaway test route — covers: missing header → 401 `UNAUTHORIZED`; non-`Bearer ` prefix → 401 `UNAUTHORIZED`; malformed JWT → 401 `INVALID_TOKEN`; expired JWT → 401 `TOKEN_EXPIRED`; valid JWT → handler sees populated `request.user`

**Checkpoint**: `pnpm test` passes for unit + identity tests; route stubs respond 501; foundation ready.

---

## Phase 3: User Story 1 - Self-service account creation with email verification (Priority: P1) 🎯 MVP

**Goal**: A first-time visitor registers, receives a 6-digit OTP by email, submits it, becomes verified, and immediately holds a session — all atomic, all audited, no schema bypass.

**Independent Test**: `POST /auth/register` returns 201 + Mailpit shows OTP email; `POST /auth/verify-email` with the OTP returns 200 with `accessToken` body + signed `refresh_token` cookie; `audit_logs` contains `user.registered` then `user.verified` rows; replaying registration with the same unverified email succeeds (atomic replace); replaying with a verified email fails `409 DUPLICATE_EMAIL`.

### Tests for User Story 1 (write FIRST, ensure they FAIL)

- [ ] T023 [P] [US1] Integration tests for `POST /auth/register` in [tests/integration/modules/auth/register.test.ts](../../tests/integration/modules/auth/register.test.ts) covering: 201 happy path with audit row inserted (FR-101 / FR-112); password < 12 chars → 400 `VALIDATION_ERROR` (FR-101); duplicate verified email → 409 `DUPLICATE_EMAIL` (FR-101); duplicate **unverified** email → 201 with old user+verification atomically replaced (FR-101 clarification Q3); email-delivery failure still returns 201 (FR-102 fire-and-forget); audit-rollback invariant — wrap call in a forced-rollback tx and assert zero `user.registered` rows remain (FR-112 / SC-105)
- [ ] T024 [P] [US1] Integration tests for `POST /auth/verify-email` in [tests/integration/modules/auth/verify-email.test.ts](../../tests/integration/modules/auth/verify-email.test.ts) covering: correct OTP → 200 with `accessToken` JSON body + `Set-Cookie: refresh_token=…; HttpOnly; SameSite=Lax`, `users.is_verified=true`, `email_verifications` row deleted, `user.verified` audit row present (FR-104 / FR-112); expired OTP → 422 `OTP_EXPIRED`, user remains unverified (FR-104, US1 acceptance #3); wrong OTP → 401 `INVALID_CREDENTIALS`, user remains unverified (US1 acceptance #4)

### Implementation for User Story 1

- [ ] T025 [US1] Implement `register` in [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — runs entirely inside `withTx`: lookup by email; if verified → throw `AppError.duplicateEmail()`; if unverified → DELETE prior user row (cascade clears verification); INSERT new user (`is_verified=false`, `password_hash` from `hashPassword`); INSERT verification row (`otp_hash`, `expires_at = now + OTP_TTL_MINUTES`, `last_sent_at = now`); `emitAudit(tx, { event:'user.registered', actorId:user.id, entityType:'user', entityId:user.id, payload:{ data:{ email } }, orgId:null })`; AFTER tx commits (post-`withTx`) fire-and-forget `notify.sendOtp(email, code)` — failures are logged only (FR-102)
- [ ] T026 [US1] Wire `POST /auth/register` handler in [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) — Zod-parse body via `auth.schemas.ts`, call `service.register`, return `201 { success:true, data:{ message:'Verification email sent.' } }` envelope
- [ ] T027 [US1] Implement `verifyEmail` in [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — inside `withTx`: lookup user by email; if missing OR no verification row OR `hashOtp(input) !== otp_hash` → throw `AppError.invalidCredentials()` (parity); if `expires_at < now` → throw `AppError.otpExpired()`; UPDATE `users.is_verified=true`; DELETE verification row; call `issueSessionWithinTx(tx, user)`; emit `user.verified` audit; return `{ accessToken, refreshCookieValue }`
- [ ] T028 [US1] Wire `POST /auth/verify-email` handler in [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) — Zod-parse body, call `service.verifyEmail`, set signed cookie via `reply.setCookie(REFRESH_COOKIE_NAME, refreshCookieValue, buildRefreshCookieAttrs())`, return `200 { success:true, data:{ accessToken } }`

**Checkpoint**: User Story 1 fully exercised end-to-end. Quickstart steps 1, 2, 9, 11 pass.

---

## Phase 4: User Story 2 - Returning user login (Priority: P1)

**Goal**: A verified user signs in with email + password and receives a session. Unverified users, wrong passwords, and unknown emails all produce a single byte-equal rejection so registration status cannot be probed.

**Independent Test**: Pre-create a verified user; login with correct creds → 200 + access JWT + refresh cookie + `user.login` audit row; login with wrong password / unknown email / unverified email → all three responses are byte-equal `401 INVALID_CREDENTIALS` (verified by automated diff per SC-106).

### Tests for User Story 2 (write FIRST, ensure they FAIL)

- [ ] T029 [P] [US2] Integration tests for `POST /auth/login` in [tests/integration/modules/auth/login.test.ts](../../tests/integration/modules/auth/login.test.ts) covering: verified user + correct password → 200 with `accessToken` + `Set-Cookie: refresh_token=…; HttpOnly; SameSite=Lax`, `user.login` audit row present (FR-105 / FR-107 / FR-112); wrong-password vs unknown-email vs unverified-user responses are byte-equal `401 INVALID_CREDENTIALS` — diff three responses and assert equality (FR-105 / FR-106 / SC-104 / SC-106); login p95 latency under 200 ms across 100 sequential calls against a seeded 10 000-user table (SC-102)

### Implementation for User Story 2

- [ ] T030 [US2] Implement `login` in [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — inside `withTx`: lookup user by email; if missing OR `!verifyPassword(input, hash)` OR `!user.is_verified` → throw `AppError.invalidCredentials()`; call `issueSessionWithinTx(tx, user)`; emit `user.login` audit; return `{ accessToken, refreshCookieValue }`. Fixed-cost path: always run `verifyPassword` against a known dummy hash on the user-not-found branch to avoid timing-based enumeration.
- [ ] T031 [US2] Wire `POST /auth/login` handler in [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) — Zod-parse body, call `service.login`, set refresh cookie, return `200 { success:true, data:{ accessToken } }`

**Checkpoint**: Quickstart steps 4, 5 pass. Login latency assertion green.

---

## Phase 5: User Story 3 - Continuous session with rotation and theft detection (Priority: P1)

**Goal**: Refresh rotates BOTH credentials inside a single transaction; replay of an already-rotated cleartext deletes every refresh-token row for that user (theft cascade); expired or absent cookies are rejected without cascade.

**Independent Test**: Login → capture cookie A → refresh with A → success, receive cookie B → replay A → 401 + DB shows zero refresh-token rows for that user → replay B → also 401 (its row was wiped by cascade).

### Tests for User Story 3 (write FIRST, ensure they FAIL)

- [ ] T032 [P] [US3] Integration tests for `POST /auth/refresh` in [tests/integration/modules/auth/refresh.test.ts](../../tests/integration/modules/auth/refresh.test.ts) covering: valid cookie → 200 with new `accessToken` + new `Set-Cookie` whose value differs, prior refresh-token row gone, exactly one refresh row remains for the user (FR-108); replay of a rotated cleartext (parseable userId, no DB hit) → 401 `UNAUTHORIZED` + ALL refresh-token rows for that user deleted (FR-109 / SC-103); cleartext whose hash matches an EXPIRED row → 401 `UNAUTHORIZED` + that row deleted, OTHER user rows untouched (FR-109); request with no cookie → 401 `UNAUTHORIZED` no DB writes (FR-109 last clause); cleartext with malformed shape (no `<uuid>.<hex>`) → 401 `UNAUTHORIZED` no cascade

### Implementation for User Story 3

- [ ] T033 [US3] Implement `refresh` in [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — read signed cookie (Fastify auto-validates signature; reject `UNAUTHORIZED` if missing/invalid before any DB call); inside `withTx`: `hash = hashRefreshToken(cleartext)`; SELECT row by hash; on hit + not expired → DELETE that row + INSERT a new row + load user + `signAccessToken` + return new cookie value; on hit + expired → DELETE row, throw `AppError.unauthorized()`; on miss → `parseUserIdFromCleartext`; if parses → `deleteAllRefreshTokensForUser(tx, userId)` then throw `AppError.unauthorized()`; if not → throw `AppError.unauthorized()`. No audit event on refresh (per data-model.md table — only register/verify/login/logout).
- [ ] T034 [US3] Wire `POST /auth/refresh` handler in [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) — read `request.cookies[REFRESH_COOKIE_NAME]` via `request.unsignCookie`, call `service.refresh`, set new refresh cookie on success / clear cookie on failure, return `200 { success:true, data:{ accessToken } }` or let `AppError` propagate to the global error handler

**Checkpoint**: Quickstart steps 6, 7 pass. SC-103 theft test green.

---

## Phase 6: User Story 4 - Resend verification code with abuse guard (Priority: P2)

**Goal**: Allow a user who missed the OTP email to request a fresh one, but reject calls inside the cooldown window. Unknown emails MUST receive the same rejection shape as cooldown-blocked legitimate ones.

**Independent Test**: Register `bob@example.com` → immediately call resend → 422 `OTP_COOLDOWN`; wait 60 s + 1 → resend → 200 + new email + previous code now invalid; call resend with `nobody@example.com` → identical 422 `OTP_COOLDOWN` response (parity).

### Tests for User Story 4 (write FIRST, ensure they FAIL)

- [ ] T035 [P] [US4] Integration tests for `POST /auth/resend-otp` in [tests/integration/modules/auth/resend-otp.test.ts](../../tests/integration/modules/auth/resend-otp.test.ts) covering: inside cooldown → 422 `OTP_COOLDOWN` (FR-103); past cooldown → 200, new `otp_hash` differs from old, `last_sent_at` updated, old code submitted to verify-email is rejected (FR-102 single-active-record + FR-103); unknown email → response byte-equal to cooldown response (FR-106 enumeration parity); resend on a verified user → byte-equal `OTP_COOLDOWN` parity (resend has no legitimate purpose post-verification, leaks nothing)

### Implementation for User Story 4

- [ ] T036 [US4] Implement `resendOtp` in [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — inside `withTx`: lookup user by email; on missing-user OR verified-user OR `now - last_sent_at < OTP_RESEND_COOLDOWN_SEC` → throw `AppError.otpCooldown()` (parity sink); else generate fresh OTP, UPSERT verification row (new `otp_hash`, new `expires_at`, `last_sent_at = now`); after commit → fire-and-forget `notify.sendOtp(email, code)`. No audit event for resend.
- [ ] T037 [US4] Wire `POST /auth/resend-otp` handler in [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) — Zod-parse body, call `service.resendOtp`, return `200 { success:true, data:{ message:'Verification email sent.' } }`

**Checkpoint**: Quickstart step 8 passes.

---

## Phase 7: User Story 5 - Explicit sign-out (Priority: P2)

**Goal**: A signed-in user can deterministically end the session on the current device. Logout deletes the matching refresh-token row, clears the cookie, emits one `user.logout` audit row on first call, and is idempotent for retries.

**Independent Test**: Login → capture cookie → logout → 204 + cookie cleared + refresh row gone + `user.logout` audit row present; logout again with the same (now invalid) cookie → still 204, no error, no new audit row; logout with no cookie → 204, no error.

### Tests for User Story 5 (write FIRST, ensure they FAIL)

- [ ] T038 [P] [US5] Integration tests for `POST /auth/logout` in [tests/integration/modules/auth/logout.test.ts](../../tests/integration/modules/auth/logout.test.ts) covering: valid cookie → 204 + `Set-Cookie` clearing `refresh_token` + DB row gone + one `user.logout` audit row (FR-110 / FR-112); idempotency — second logout with the same now-invalid cookie → 204, no error, NO additional audit row (FR-110 / SC-107); logout with no cookie → 204, no error, no DB writes (FR-110); rotated cookie cannot refresh after logout — quickstart step 10 → subsequent refresh attempt → 401 (FR-110)

### Implementation for User Story 5

- [ ] T039 [US5] Implement `logout` in [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — if cookie absent → return `{ deleted:false }` (no tx, no audit); else inside `withTx`: `hash = hashRefreshToken(cleartext)`; SELECT row by hash; if found → DELETE row + emit `user.logout` audit (`payload.data.sessionsRemaining = count(*)` after delete); if not found → return `{ deleted:false }` no audit. Always idempotent.
- [ ] T040 [US5] Wire `POST /auth/logout` handler in [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) — read + unsign cookie (tolerate absent / invalid), call `service.logout`, ALWAYS `reply.clearCookie(REFRESH_COOKIE_NAME, buildRefreshCookieAttrs())`, return `204` with empty body

**Checkpoint**: Quickstart step 10 passes. All 5 user stories independently pass.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T041 [P] Verify each OpenAPI fragment in [contracts/](./contracts/) (`register.openapi.yaml`, `verify-email.openapi.yaml`, `resend-otp.openapi.yaml`, `login.openapi.yaml`, `refresh.openapi.yaml`, `logout.openapi.yaml`) matches the implemented Zod schemas via a contract-conformance test in [tests/integration/modules/auth/contracts.test.ts](../../tests/integration/modules/auth/contracts.test.ts) — assert request/response shapes, status codes, and registry-listed error codes only
- [ ] T042 [P] Confirm `pnpm test:coverage` reports ≥ 80% line + branch for the auth module (Constitution II); add focused unit tests in [tests/unit/modules/auth/](../../tests/unit/modules/auth/) for any uncovered branches
- [ ] T043 [P] Run `pnpm lint` and `pnpm typecheck` clean across the auth module — no `any` without inline justification (Constitution I)
- [ ] T044 Execute the full [quickstart.md](./quickstart.md) walkthrough manually against `pnpm dev` and confirm every "Done-When mapping" row is satisfied
- [ ] T045 Confirm SC-101 (register → verify → first authed call < 60 s end-to-end) and SC-102 (login p95 < 200 ms at 10 000 users) via the seeded latency test added in T029; record the measured p95 in a comment at the top of [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** — no dependencies; can start immediately
- **Phase 2 (Foundational)** — depends on Phase 1; **BLOCKS all user stories**
- **Phase 3 / 4 / 5 / 6 / 7 (User Stories)** — all depend on Phase 2; the three P1 stories (US1, US2, US3) form the MVP; P2 stories (US4, US5) deliver after MVP
- **Phase 8 (Polish)** — depends on all five user-story phases

### User Story Dependencies

- **US1 (P1)** — depends only on Phase 2; introduces register + verify-email
- **US2 (P1)** — depends only on Phase 2; independent of US1 in code (different service method, different route, different test file). Can be implemented in parallel with US1 if staffed.
- **US3 (P1)** — depends only on Phase 2; refresh logic is self-contained. Independent in code from US1/US2.
- **US4 (P2)** — depends on Phase 2; in tests reuses register from US1 to set up the cooldown scenario, but production code is independent
- **US5 (P2)** — depends on Phase 2; in tests reuses login from US2 to set up the logout scenario, but production code is independent

### Within Each User Story

- Integration tests written and FAILING before any handler implementation (TDD; Constitution II)
- Service method before route wire-up (route handlers are thin adapters)
- Within-phase implementation tasks share `auth.service.ts` and `auth.routes.ts` and are therefore sequential, NOT [P]

### Same-File Conflicts (NOT parallelizable across stories)

- [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts) — every story phase appends one method
- [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts) — every story phase wires one handler
- [src/modules/auth/auth.repository.ts](../../src/modules/auth/auth.repository.ts) — built once in T018 and not modified by story phases

If multiple developers work US1/US2/US3 in parallel, they MUST coordinate merges on `auth.service.ts` and `auth.routes.ts`. The repository file is intentionally complete after T018 to minimize cross-story conflicts.

---

## Parallel Examples

### Phase 1 Setup — fully parallel after T001

```text
T002 — env.ts COOKIE_SECRET                  (file: src/shared/config/env.ts)
T003 — server.ts cookie plugin               (file: src/server.ts)
T004 — fix transactional fixture             (file: tests/integration/helpers/db.ts)
T005 — constants.ts                          (file: src/modules/auth/constants.ts)
```

### Phase 2 — pure helpers + their unit tests + shared infra all parallel

```text
T006 password.ts          T010 password.test.ts
T007 tokens.ts            T011 tokens.test.ts
T008 otp.ts               T012 otp.test.ts
T009 cookies.ts
T013 errors codes + AppError factories
T014 jwt.ts signAccessToken
T015 fastify.d.ts augment
T016 identity.ts
T017 auth.schemas.ts
```

T018 (repository), T019 (service skeleton), T020 (routes scaffold), T021 (server wire-up), T022 (identity test) are sequential after the parallel batch above.

### Per-story integration tests — runnable in parallel within phase

```text
US1: T023 (register.test.ts) + T024 (verify-email.test.ts)
US3: T032 alone (refresh.test.ts)
```

### Cross-story parallelism — three P1 stories simultaneously

After Phase 2 completes, US1 / US2 / US3 can be developed in parallel by three engineers (subject to merge coordination on `auth.service.ts` and `auth.routes.ts`).

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 — all P1)

The spec marks register, login, AND refresh-with-theft-detection as P1 because a session model without rotation is not a credible MVP. Therefore the minimum shippable slice is all three:

1. Phase 1 + Phase 2 — foundation
2. Phase 3 (US1) → independently testable
3. Phase 4 (US2) → independently testable
4. Phase 5 (US3) → independently testable
5. **STOP / VALIDATE** — quickstart steps 1–7 + 9 + 11 pass; deploy as MVP

### Incremental Delivery

6. Phase 6 (US4 resend) → demo
7. Phase 7 (US5 logout) → demo
8. Phase 8 (Polish) → final ship

### Parallel Team Strategy

With 3 engineers post-Phase-2:

- Engineer A → US1 (register + verify-email)
- Engineer B → US2 (login)
- Engineer C → US3 (refresh)

Engineers B and C may merge first since they touch fewer service-layer surfaces; engineer A's `register` is the largest single method. Coordinate on `auth.service.ts` via short-lived feature branches.

---

## Notes

- [P] tasks = different files, no incomplete-task dependencies
- Every state-changing handler runs inside `withTx` so `emitAudit(tx, …)` joins the same transaction (Constitution audit invariant from Phase 0; FR-112)
- Cleartext OTP and cleartext refresh-token values MUST never be persisted — only their SHA-256 hashes go to the DB (FR-102 / FR-107)
- Wrong-password / unknown-email / unverified-user login responses MUST be byte-equal — verified by automated diff (FR-105 / FR-106 / SC-106)
- Resend / unknown-email / verified-user resend responses MUST be byte-equal `OTP_COOLDOWN` — verified by automated diff (FR-103 / FR-106)
- No new tables, no migrations — Phase 0 schema is sufficient (data-model.md)
- Commit after each task or each `[P]` batch; verify tests fail before implementing the corresponding handler

---

## Format Validation

All 45 tasks above strictly follow `- [ ] [TaskID] [P?] [Story?] Description with file path`:

- Setup (T001–T005): no story label ✓
- Foundational (T006–T022): no story label ✓
- US1 (T023–T028): `[US1]` label ✓
- US2 (T029–T031): `[US2]` label ✓
- US3 (T032–T034): `[US3]` label ✓
- US4 (T035–T037): `[US4]` label ✓
- US5 (T038–T040): `[US5]` label ✓
- Polish (T041–T045): no story label ✓
- Every task includes an exact file path or path glob ✓
- `[P]` only on tasks that do not share a file with another incomplete task ✓
