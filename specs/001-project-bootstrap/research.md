# Phase 0 Research: Project Bootstrap

**Feature**: 001-project-bootstrap
**Date**: 2026-05-01

This document resolves all technology choices for Phase 0. Each section follows the
Decision / Rationale / Alternatives format.

---

## 1. Runtime & Language Versions

**Decision**: Node.js 24 LTS, TypeScript 6.x, ES2024 module target.

**Rationale**: Node 24 is the current LTS as of May 2026; TypeScript 6 brings refined
inference and better ESM interop. Both are stable and supported by every dependency below.

**Alternatives considered**: Node 22 LTS (older, missing perf-hooks improvements);
Node 26 (not yet LTS).

---

## 2. HTTP Framework — Fastify 5.8.x

**Decision**: Fastify 5.8.x with `@fastify/sensible`, `@fastify/cookie`, `@fastify/cors`,
and `fastify-type-provider-zod`.

**Rationale**: Fastify is fast (≈30k req/s on commodity hardware), schema-first, and
ships first-class plugin support that maps cleanly onto the modular monolith structure
(each `src/modules/*` is a Fastify plugin). The Zod type provider gives us runtime
validation + compile-time types from a single schema.

**Alternatives considered**: Express (slower, no built-in schema validation, weaker
TypeScript story); Hono (newer, smaller ecosystem); NestJS (decorators add complexity
that the modular monolith pattern doesn't need).

---

## 3. ORM — Drizzle ORM + drizzle-kit

**Decision**: Drizzle ORM (latest) with `drizzle-kit` for migration generation. Use the
`@neondatabase/serverless` driver with the websocket pool for production and the
standard Postgres driver for local dev.

**Rationale**: Drizzle is type-safe, lightweight, and produces predictable SQL. It
exposes raw transaction handles, which we need for the audit-emitter contract (FR-004).
Schema is defined in TypeScript and migrations are generated on demand.

**Alternatives considered**: Prisma (heavier, generated client adds build step,
transaction API less ergonomic for the audit emitter); Kysely (good but less mature
migration tooling); raw `pg` (no type safety).

---

## 4. Database Driver — `@neondatabase/serverless`

**Decision**: `@neondatabase/serverless` for production (Neon WebSocket pool). For
integration tests, use `pg` against a local Postgres in docker-compose.

**Rationale**: Neon's serverless driver is the recommended path for Neon-hosted
Postgres; it works in any Node environment and handles connection pooling efficiently.
Local dev/CI use vanilla `pg` against a docker container — same SQL dialect, faster
loops.

**Alternatives considered**: `pg` against Neon directly (works but loses Neon's
serverless connection optimizations); `postgres` (Porsager) (good driver but less
common in the Drizzle ecosystem).

---

## 5. JWT Library — `jose`

**Decision**: `jose` for JWT verification in Phase 0 (issuance arrives in Phase 1).
HS256 with a 256-bit shared secret (validated as ≥ 32 chars by env Zod schema per FR-007).

**Rationale**: `jose` is the modern, RFC-compliant JWT library with native promises and
strong TypeScript types. It supports async key rotation if we move to RS256 later.

**Alternatives considered**: `jsonwebtoken` (callback-based, older API, weaker types);
`@fastify/jwt` (wraps `fast-jwt`; usable, but locks the verification logic to a Fastify
plugin which we want to keep portable across modules).

---

## 6. Password Hashing — `bcryptjs`

**Decision**: `bcryptjs` (pure-JS implementation).

**Rationale**: Avoids `node-gyp` build failures on Windows dev machines. The performance
difference vs native `bcrypt` is acceptable for the cost-12 hashing we'll do at register
and login (Phase 1) — cost is bounded by the bcrypt round count, not the implementation.

**Alternatives considered**: `bcrypt` (native, faster, but adds Windows toolchain
friction); `argon2` (better security, but `bcrypt` is the implementation plan's stated
choice).

---

## 7. Validation — Zod 4.x

**Decision**: Zod 4.x for env schema, request/response validation, and contract types.

**Rationale**: Zod 4 brings significant performance improvements over v3 and a more
ergonomic API. `fastify-type-provider-zod` lets a single Zod schema both validate at
runtime and infer the request/response types. Used throughout: env validation
(FR-007), endpoint schemas, audit emitter payload typing.

**Alternatives considered**: TypeBox (faster runtime, but less ergonomic and smaller
ecosystem); Yup (no type inference); Valibot (newer, smaller community).

---

## 8. Logging — Pino

**Decision**: Pino with structured JSON output. Configured via Fastify's built-in
`logger` option. Auto-redact `password`, `otp`, and `Authorization` header fields.

**Rationale**: Pino is Fastify's default and produces line-delimited JSON (per the
Constitution's Technical Standards). Performance is industry-leading. Redaction is
declarative.

**Alternatives considered**: Winston (slower, more configuration); Bunyan (older);
console (does not satisfy structured-logging requirement).

---

## 9. Email Transport — Nodemailer

**Decision**: Nodemailer with SMTP transport. Local dev points to Mailpit (docker
container with web UI on :8025); production reads SMTP creds from env vars.

**Rationale**: Nodemailer is the de facto Node email library; SMTP is universally
supported. Mailpit gives developers a local inbox to verify OTP and invitation emails
without sending real mail.

**Alternatives considered**: Resend / Postmark / SendGrid SDKs (provider-locked);
MailHog (less actively maintained than Mailpit).

---

## 10. Migration Runner with Advisory Lock (FR-001 / SC-007)

**Decision**: Custom thin wrapper around `drizzle-kit migrate`. The wrapper opens a
dedicated connection, runs `SELECT pg_advisory_lock(<constant>)` (constant: a hashed
project identifier, e.g. `0x47494f56` for "GIOV"), invokes drizzle's migrate, then
calls `pg_advisory_unlock`. Concurrent runners block on the lock; once they acquire it
the migration tracker shows no pending work and they exit cleanly.

**Rationale**: drizzle-kit does not ship concurrency protection. Postgres advisory
locks are session-scoped, free, and well-suited to this exact problem.

**Alternatives considered**: Add a `migration_lock` table with `SELECT … FOR UPDATE`
(works, but introduces a stateful row that must be migrated before migrations); rely on
"only one runner at a time" convention (rejected — fails in container-orchestrated
deployments).

---

## 11. Integration Test Database Strategy

**Decision**: Local Postgres 17 via `docker-compose.yml`. Each test that touches the
database opens a transaction in a `beforeEach` hook and rolls back in `afterEach`.
Migrations are run once per test session against a dedicated test database.

**Rationale**: Real Postgres catches dialect issues that mocks miss (Constitution
Principle II forbids mocking DB calls). Transactional fixtures keep tests fast and
isolated. Docker-compose works on all dev OSes and CI runners.

**Alternatives considered**: Testcontainers-Postgres (slower startup on Windows, harder
to debug); Neon dev branch DB (per-PR branch creation adds complexity and creds
management); `pg-mem` (does not support advisory locks, JSON operators, or all
constraint types).

---

## 12. Package Manager — pnpm

**Decision**: pnpm (latest 10.x).

**Rationale**: Symlink-based store reduces disk usage and install time as `src/modules/`
grows. Workspace support is ready for a future split into separate packages if the
monolith outgrows a single repo. Lockfile is deterministic and reviewer-friendly.

**Alternatives considered**: npm (works fine, slower installs); Yarn 4 (good but less
common); Bun (fast but production-readiness for serverside workloads still maturing).

---

## 13. Lint & Format — ESLint 9 (Flat Config) + Prettier 3.x

**Decision**: ESLint 9 flat config (`eslint.config.js`) with `typescript-eslint`,
`eslint-plugin-import`, and `eslint-plugin-unicorn`. Prettier 3.x for formatting. Both
run via pnpm scripts; CI rejects any warnings (Constitution Principle I).

**Rationale**: Flat config is the supported format going forward. typescript-eslint
gives type-aware rules. Prettier handles formatting; ESLint handles correctness.

**Alternatives considered**: Biome (fast and unified but rule coverage is still
narrower than ESLint); legacy `.eslintrc` (deprecated).

---

## 14. Test Runner — Vitest 3.x

**Decision**: Vitest 3.x with Vite-powered transform; coverage via `@vitest/coverage-v8`.
Two test types share the same runner: unit tests (`tests/unit/**`) and integration
tests (`tests/integration/**`) — separated by glob in `vitest.config.ts` so they can be
run independently.

**Rationale**: Vitest is dramatically faster than Jest, supports ESM out of the box,
and uses the same expect API (`expect(...).toBe(...)`). Coverage gate set to 80% line +
80% branch (Constitution Principle II).

**Alternatives considered**: Jest (slower, ESM story still rough); Node test runner
(too minimal — no built-in mocking, weaker watch mode).

---

## 15. Health Check Implementation (FR-009 / SC-006)

**Decision**: `GET /health` performs a lightweight `SELECT 1` against the database
connection pool with a 1-second `statement_timeout`. On success returns 200 with
`{ status: "ok", timestamp }`. On failure returns 503 with
`{ status: "degraded", reason }` within the 2-second budget.

**Rationale**: Load balancers route based on 2xx vs non-2xx; 503 cleanly signals
"don't send me traffic." The 1-second SQL timeout gives a 1-second safety margin for
serializing the response within SC-006's 2-second budget.

---

## 16. Permission Guard (FR-006)

**Decision**: Fastify pre-handler factory. Each protected route registers
`requirePermission('member:invite')` (or similar). The pre-handler:
1. Verifies the JWT and extracts `userId`.
2. Loads `org_id` from the route param (`:orgId`).
3. Queries `memberships JOIN roles` filtered by `(user_id, org_id)`. If `roles.is_owner`
   is true, passes unconditionally. Otherwise checks the requested permission key
   against the role's stored permission array.
4. If the org doesn't exist or the user has no membership, returns FORBIDDEN — no
   distinction (per Q2 clarification).

**No caching layer** (Constitution + FR-006). Single indexed join per request keeps
the guard well within its 50 ms budget.

---

## 17. Environment Variable Validation (FR-007)

**Decision**: Single Zod schema in `src/shared/config/env.ts`. Required variables for
Phase 0:

| Variable | Type | Constraint |
|----------|------|------------|
| `NODE_ENV` | enum | `development` / `production` / `test` |
| `PORT` | number | 1024–65535, default 3000 |
| `DATABASE_URL` | URL | starts with `postgres://` or `postgresql://` |
| `JWT_SECRET` | string | min 32 chars |
| `JWT_ACCESS_TTL_SECONDS` | number | default 900 |
| `JWT_REFRESH_TTL_SECONDS` | number | default 604800 |
| `SMTP_HOST` | string | required if `NODE_ENV=production` |
| `SMTP_PORT` | number | default 1025 (Mailpit) |
| `SMTP_USER` | string | optional in dev |
| `SMTP_PASSWORD` | string | min 8 chars in production |
| `SMTP_FROM` | email | required |
| `LOG_LEVEL` | enum | `trace`/`debug`/`info`/`warn`/`error`, default `info` |

The `parse(process.env)` call runs at the top of `main.ts` before anything else; on
failure it prints a list of failing variables and `process.exit(1)`s within 5 seconds
(SC-004).

---

## 18. Containerization

**Decision**: Single Dockerfile (multi-stage: `node:24-bookworm-slim` base) producing a
production image. Local dev does not require the image — `pnpm dev` runs against the
docker-compose Postgres + Mailpit. Phase 0 ships only the build configuration; full
container hardening lands in Phase 5.

**Rationale**: Implementation plan defers production deployment specifics to Phase 5.
We bake only the minimum needed to verify Phase 0 deliverables.

---

## All NEEDS CLARIFICATION Resolved

No outstanding items. Ready to proceed to Phase 1 (data model + contracts).
