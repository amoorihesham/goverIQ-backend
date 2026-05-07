# Implementation Plan: Authentication Module

**Branch**: `002-auth-module` | **Date**: 2026-05-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-auth-module/spec.md`

## Summary

Compose six Fastify routes (`POST /auth/register`, `verify-email`, `resend-otp`,
`login`, `refresh`, `logout`) and one reusable `identityRequired` pre-handler against
the Phase 0 substrate. No schema changes — the auth tables (`users`,
`email_verifications`, `refresh_tokens`) already exist. New runtime dependency:
`@fastify/cookie` for signed httpOnly refresh-token cookies. New shared additions:
JWT signing helper, identity pre-handler, two error codes (`OTP_EXPIRED`,
`OTP_COOLDOWN`), one env var (`COOKIE_SECRET`). Four audit events emit transactionally:
`user.registered`, `user.verified`, `user.login`, `user.logout`. The module satisfies
all 13 functional requirements (FR-101 … FR-113) and all 7 success criteria
(SC-101 … SC-107) from the spec.

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js 24 LTS (unchanged from Phase 0)
**Primary Dependencies**: Fastify 5.8.x, Drizzle ORM, `jose`, `bcryptjs`, Zod 4.x,
Pino, Nodemailer (all installed). **New**: `@fastify/cookie` (signed cookies).
**Storage**: existing `users` / `email_verifications` / `refresh_tokens` Postgres
tables — no migrations.
**Testing**: Vitest (unit + integration); transactional fixture at
[tests/integration/helpers/db.ts](../../tests/integration/helpers/db.ts) requires a
small fix (research.md item 5) before integration tests can use it correctly.
**Target Platform**: Linux server / Node.js 24 (containerized; stateless).
**Project Type**: Backend web service — modular monolith (this feature adds the
first domain module under `src/modules/`).
**Performance Goals**: Login p95 < 200 ms (Constitution IV). Bcrypt cost factor 11
(≈ 125 ms / hash) leaves ~75 ms headroom for DB lookup + JWT signing + envelope
serialization. All other auth endpoints comfortably under budget.
**Constraints**: Every state-changing handler MUST run inside `withTx` so that
`emitAudit(tx, …)` joins the same transaction (FR-112 + Constitution audit invariant
from Phase 0). Cleartext OTP and cleartext refresh-token values MUST never be
persisted (FR-102, FR-107). Wrong-password / unknown-email / unverified-user login
responses MUST be byte-equal (FR-105 / FR-106 / SC-106).
**Scale/Scope**: 6 routes, 1 pre-handler, 4 audit events, 2 new error codes, ≈ 10
new source files plus tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Status | Gate Verification                                                                                                                                                                                   |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Code Quality              | Pass   | Module split (routes / service / repository / pure helpers); no cross-domain imports; lint + Prettier configured; `any` requires inline justification                                               |
| II. Testing Standards        | Pass   | Unit tests for `password.ts`, `tokens.ts`, `otp.ts`; integration tests for every route and every FR; coverage stays ≥ 80%; TDD enforced                                                             |
| III. API Design Consistency  | Pass   | All responses use the existing envelope; all error responses use codes from the registry (extended with `OTP_EXPIRED` + `OTP_COOLDOWN` here); contracts authored in `contracts/` before any handler |
| IV. Performance Requirements | Pass   | Login p95 < 200 ms via bcrypt cost = 11 + indexed `users_email_idx` lookup + RAM-only JWT signing; refresh and verify-email also single-query                                                       |

**Pre-design Constitution Check: PASS.** No violations. Complexity Tracking section
is empty. Re-evaluation post-design recorded at the bottom of this file.

## Project Structure

### Documentation (this feature)

```text
specs/002-auth-module/
├── plan.md              # This file
├── research.md          # Phase 0 output (technology decisions for this feature)
├── data-model.md        # Phase 1 output — column-level mapping; no schema changes
├── quickstart.md        # Phase 1 output — verification walkthrough
├── contracts/           # Phase 1 output — 6 OpenAPI fragments + identityRequired contract
└── tasks.md             # Phase 2 output (NOT created here — comes from /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── modules/
│   └── auth/                       # NEW — first domain module
│       ├── index.ts                # Fastify plugin export
│       ├── auth.routes.ts          # 6 endpoints registered
│       ├── auth.service.ts         # business logic + withTx + emitAudit
│       ├── auth.repository.ts      # Drizzle queries on users / email_verifications / refresh_tokens
│       ├── auth.schemas.ts         # Zod input/output schemas
│       ├── password.ts             # bcryptjs wrapper; PASSWORD_COST_FACTOR = 11
│       ├── tokens.ts               # JWT signing + refresh-token random + SHA-256 hashing
│       ├── otp.ts                  # 6-digit OTP gen + SHA-256 hash
│       ├── cookies.ts              # refresh cookie name + attribute factory
│       └── constants.ts            # all numeric tunables in one place
├── shared/
│   ├── auth/
│   │   ├── jwt.ts                  # ADD signAccessToken(); existing verifyAccessToken() unchanged
│   │   └── identity.ts             # NEW — identityRequired Fastify pre-handler
│   ├── errors/
│   │   ├── codes.ts                # ADD OTP_EXPIRED (422) + OTP_COOLDOWN (422)
│   │   └── http-error.ts           # ADD AppError.otpExpired() + AppError.otpCooldown()
│   └── config/
│       └── env.ts                  # ADD COOKIE_SECRET (z.string().min(32))
├── types/
│   └── fastify.d.ts                # AUGMENT FastifyRequest with `user?: { userId, email }`
└── server.ts                       # register @fastify/cookie + auth plugin

tests/
├── unit/
│   └── modules/auth/
│       ├── password.test.ts
│       ├── tokens.test.ts
│       └── otp.test.ts
└── integration/
    ├── helpers/
    │   └── db.ts                   # FIX broken transactional fixture (research.md #5)
    └── modules/auth/
        ├── register.test.ts        # FR-101 (incl. unverified-replacement, dup-email, audit-rollback)
        ├── verify-email.test.ts    # FR-102 / FR-104; OTP_EXPIRED; wrong code
        ├── resend-otp.test.ts      # FR-103; enumeration parity
        ├── login.test.ts           # FR-105 / FR-106; SC-104; SC-106 byte-equality
        ├── refresh.test.ts         # FR-108 / FR-109; SC-103 theft detection
        ├── logout.test.ts          # FR-110; SC-107 idempotency
        └── identity.test.ts        # FR-111; missing / malformed / expired
```

**Structure Decision**: Single-project modular monolith — same pattern Phase 0
established. `src/modules/auth/` is the first occupant of the previously empty
`src/modules/` directory; it sets the template every later phase will follow
(routes / service / repository / pure helpers / Zod schemas / Fastify plugin
export). The `src/shared/` additions are minimal and stay strictly cross-cutting
(JWT, identity guard, error codes, env validation).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. This section is intentionally empty.

---

## Post-Design Constitution Re-check

After generating `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`:

| Principle                    | Status | Notes                                                                                                                                                                                                                             |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Code Quality              | Pass   | Single responsibility per file; pure helpers (`password`, `tokens`, `otp`) have no Fastify dependency; service layer is the only place transactions begin                                                                         |
| II. Testing Standards        | Pass   | Test plan in this file lists 1 unit-test file per pure helper and 1 integration-test file per route + 1 for the pre-handler; covers every FR / SC                                                                                 |
| III. API Design Consistency  | Pass   | Six OpenAPI fragments authored in `contracts/` use the exact envelope from Phase 0's `response-envelope.md`; only registry error codes referenced                                                                                 |
| IV. Performance Requirements | Pass   | bcrypt cost calibrated to 11 in `research.md` item 3; lookups all hit unique indexes (`users_email_idx`, `email_verifications_user_idx`, `refresh_tokens_hash_idx`); no N+1 patterns possible — every flow is a fixed-shape query |

**Post-design Constitution Check: PASS.** Ready for `/speckit-tasks`.
