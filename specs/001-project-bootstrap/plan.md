# Implementation Plan: Project Bootstrap — Schema & Shared Infrastructure

**Branch**: `001-project-bootstrap` | **Date**: 2026-05-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-project-bootstrap/spec.md`

## Summary

Bootstrap the GovernIQ backend (Phase 0 of the master implementation plan) as a TypeScript
modular monolith on Fastify with Drizzle ORM and Postgres (Neon). Deliver all 17 data
tables in a single advisory-locked migration plus five shared infrastructure components
(system permission set, error envelope, audit emitter, notification service, permission
guard) that all later phases will depend on. No domain modules ship in Phase 0.

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js 24 LTS
**Primary Dependencies**: Fastify 5.8.x, Drizzle ORM, drizzle-kit, @neondatabase/serverless,
`jose` (JWT verify), bcryptjs, Zod 4.x, Pino, Nodemailer
**Storage**: Postgres (Neon serverless in production; local Postgres via docker-compose for dev/CI)
**Testing**: Vitest (unit + integration); transactional fixtures against real Postgres
**Target Platform**: Linux server / Node.js 24 (containerized; stateless)
**Project Type**: Backend web service — modular monolith
**Performance Goals**: API endpoints p95 < 200 ms (Constitution IV); permission guard ≤ 50 ms per request; health-check responds within 2 s when DB unreachable (SC-006)
**Constraints**: FR-001 single atomic migration with `pg_advisory_lock`; FR-006 no permission caching; FR-004 audit emitter MUST receive a transaction handle, never the global db; structured JSON logging only
**Scale/Scope**: 17 tables, 22 permission keys, 17 error codes, 5 shared infrastructure modules, 1 user-facing endpoint (`GET /health`)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Status | Gate Verification                                                                                                     |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| I. Code Quality              | Pass   | ESLint flat config + Prettier configured; CI rejects lint warnings; `any` requires inline justification               |
| II. Testing Standards        | Pass   | Vitest configured with ≥80% coverage gate; integration tests run against real Postgres via transactional fixture      |
| III. API Design Consistency  | Pass   | Single response envelope (FR-003); fixed 17-code error registry (FR-008); REST conventions documented in `contracts/` |
| IV. Performance Requirements | Pass   | Pino structured logging; permission guard uses single indexed join with no caching; health-check uses 1 s DB timeout  |

**Pre-design Constitution Check: PASS.** No violations. Complexity Tracking section is
empty. Re-evaluation post-design recorded at the bottom of this file.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-bootstrap/
├── plan.md              # This file
├── research.md          # Phase 0 output (technology decisions)
├── data-model.md        # Phase 1 output (17 tables)
├── quickstart.md        # Phase 1 output (verification walkthrough)
├── contracts/           # Phase 1 output (envelope, error codes, permission set, internal contracts)
└── tasks.md             # Phase 2 output (NOT created here — comes from /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── modules/                  # Bounded contexts (filled in Phases 1–5)
├── shared/                   # Phase 0 deliverables — cross-cutting infrastructure
│   ├── config/               # Zod-validated environment (FR-007)
│   ├── database/             # Drizzle client + migration runner with advisory lock (FR-001)
│   ├── errors/               # Response envelope helpers + error code registry (FR-003, FR-008)
│   ├── permissions/          # Permission set constants + permission guard (FR-002, FR-006)
│   ├── audit/                # emitAudit(tx, payload) (FR-004)
│   ├── notifications/        # Nodemailer-backed service + templates (FR-005)
│   ├── auth/                 # JWT verification (issuance lands in Phase 1)
│   └── http/                 # Fastify plugin helpers + GET /health (FR-009)
├── db/
│   ├── schema/               # Drizzle table definitions (one file per domain)
│   └── migrations/           # Generated SQL from drizzle-kit
├── server.ts                 # Fastify instance assembly
└── main.ts                   # Entry: validate env → migrate → start server

tests/
├── unit/                     # Mirrors src/shared structure
├── integration/              # Real Postgres; transactional fixtures
│   ├── helpers/
│   ├── health.test.ts
│   ├── migrate.test.ts       # Concurrent migration safety (SC-007)
│   └── permission-guard.test.ts
└── setup.ts
```

**Structure Decision**: Single-project modular monolith. `src/modules/` is empty in
Phase 0 — domain modules (auth, organization, role, member, meeting, vote, minutes,
audit) land there in Phases 1–5. `src/shared/` houses every Phase 0 deliverable.
`src/db/schema/` defines all 17 tables up front per the implementation plan's
"upfront schema" principle: no schema churn across phases.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. This section is intentionally empty.

---

## Post-Design Constitution Re-check

After generating `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`:

| Principle                    | Status | Notes                                                                                      |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| I. Code Quality              | Pass   | Project structure enforces single-responsibility per file; no cross-module imports planned |
| II. Testing Standards        | Pass   | Test plan covers all 9 FRs and all 7 SCs; concurrent migration test (SC-007) included      |
| III. API Design Consistency  | Pass   | Envelope and error codes are documented contracts before any handler exists                |
| IV. Performance Requirements | Pass   | Permission guard query plan validated against indexes in data-model.md; no N+1 patterns    |

**Post-design Constitution Check: PASS.** Ready for `/speckit-tasks`.
