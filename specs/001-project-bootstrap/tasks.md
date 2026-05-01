# Tasks: Project Bootstrap — Schema & Shared Infrastructure

**Input**: Design documents from `/specs/001-project-bootstrap/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Included — spec SCs (SC-001 through SC-007) require verified test coverage; Constitution II mandates ≥80% line and branch coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on in-progress tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task description

---

## Phase 1: Setup

**Purpose**: Project scaffolding, tooling configuration, and local service definitions. No application logic ships here.

- [ ] T001 Initialize pnpm project: create `package.json` with all Phase 0 dependencies (fastify@5.8.x, drizzle-orm, @neondatabase/serverless, drizzle-kit, jose, bcryptjs, zod@4.x, pino, pino-pretty, nodemailer, @types/nodemailer, @types/bcryptjs, typescript@6.x, @types/node, vitest, @vitest/coverage-v8, eslint@9, prettier@3, @fastify/type-provider-zod) and scripts: `dev`, `build`, `start`, `lint`, `test`, `test:coverage`, `db:generate`, `db:migrate`
- [ ] T002 Configure TypeScript in `tsconfig.json` (strict mode, `moduleResolution: bundler`, `module: ESNext`, `target: ES2023`, path alias `@/*` → `src/*`, `outDir: dist`)
- [ ] T003 [P] Configure ESLint 9 flat config in `eslint.config.js` (TypeScript plugin, no unused vars, no explicit any without justification, import order)
- [ ] T004 [P] Configure Prettier in `.prettierrc` (singleQuote, semi, printWidth 100, trailingComma all) and add `.prettierignore`
- [ ] T005 [P] Create `.gitignore` (node_modules, dist, .env, \*.local, coverage, .DS_Store)
- [ ] T006 [P] Create `docker-compose.yml` with Postgres 17 service (port 5432, user/password/db: groven, healthcheck) and Mailpit service (SMTP port 1025, web UI port 8025)
- [ ] T007 [P] Create `.env.example` documenting all required variables: `DATABASE_URL`, `JWT_SECRET` (min 32 chars), `PORT` (default 3000), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `NODE_ENV`
- [ ] T008 Configure Vitest in `vitest.config.ts` (two projects: `unit` targeting `tests/unit/**`, `integration` targeting `tests/integration/**` with longer timeout 30s; coverage provider v8; coverage threshold 80% lines and branches)
- [ ] T009 [P] Configure drizzle-kit in `drizzle.config.ts` (dialect: postgresql, schema: `src/db/schema/index.ts`, out: `src/db/migrations`, `dbCredentials.url` from env)
- [ ] T010 Create full project directory skeleton: `src/modules/.gitkeep`, `src/shared/config/`, `src/shared/database/`, `src/shared/errors/`, `src/shared/permissions/`, `src/shared/audit/`, `src/shared/notifications/templates/`, `src/shared/auth/`, `src/shared/http/`, `src/db/schema/`, `src/db/migrations/.gitkeep`, `tests/unit/shared/`, `tests/integration/helpers/`

**Checkpoint**: `pnpm install` completes, `pnpm lint` exits 0, `docker compose up -d` brings up both services healthy.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core shared infrastructure that MUST exist before any user story can be implemented or tested. No user story work begins until this phase is complete.

**⚠️ CRITICAL**: All user story phases depend on this phase being complete.

- [ ] T011 [P] Create Drizzle + Neon database client in `src/shared/database/client.ts` (export `db` using `drizzle(@neondatabase/serverless)` with connection string from env; export `DbClient` type)
- [ ] T012 [P] Create fixed error code registry in `src/shared/errors/codes.ts` (17 codes as a `const` object: VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL_ERROR, DUPLICATE_EMAIL, DUPLICATE_ORG_NAME, PENDING_INVITE_EXISTS, INVALID_CREDENTIALS, TOKEN_EXPIRED, INVALID_TOKEN, DUPLICATE_BALLOT, MEETING_HAS_OPEN_VOTES, QUORUM_NOT_MET, ORG_ARCHIVED, MIGRATION_LOCK_FAILED; each entry includes `httpStatus` and default `message`)
- [ ] T013 [P] Create `AppError` class in `src/shared/errors/http-error.ts` (extends Error; fields: `code: ErrorCode`, `statusCode: number`, `message: string`; static factory methods per code)
- [ ] T014 Create response envelope helpers in `src/shared/errors/envelope.ts` (depends on T012, T013: `success<T>(data: T)` → `{ success: true, data }`, `failure(err: AppError)` → `{ success: false, error: { code, message, statusCode } }`; Fastify error handler that maps `AppError` and unknown errors to the failure envelope)
- [ ] T015 Create transactional test fixture in `tests/integration/helpers/db.ts` (wraps each test in a transaction that rolls back after; exports `useDb()` helper that returns a `Tx` handle valid only for the test's scope)
- [ ] T016 [P] Create test Fastify server factory in `tests/integration/helpers/server.ts` (builds a fresh Fastify instance with all plugins registered; returns `{ app, inject }` for HTTP injection)
- [ ] T017 Create global Vitest setup file in `tests/setup.ts` (checks `DATABASE_URL` env var is set for integration suite; fails with a clear message if not; referenced in `vitest.config.ts` globalSetup)

**Checkpoint**: Foundation complete — T011-T017 done, no user story code yet. Error envelope and DB client are importable.

---

## Phase 3: User Story 1 — Clean Database Deployment (Priority: P1) 🎯 MVP

**Goal**: All 17 tables exist after a single migration run against a blank database. The health endpoint confirms DB connectivity. Re-running migration is safe and idempotent.

**Independent Test**: Run `pnpm db:migrate` against a blank database → `\dt` lists 17 tables. Run again → no errors, no data loss. Hit `GET /health` → 200. Stop Postgres, hit again → 503 within 2 s (SC-006).

### Schema Definition

- [ ] T018 [P] [US1] Define Auth domain schema in `src/db/schema/auth.ts`: `users` (id uuid PK gen_random_uuid(), email citext NOT NULL UNIQUE, password_hash text NOT NULL, is_verified boolean NOT NULL default false, created_at/updated_at timestamptz NOT NULL default now()); `email_verifications` (id uuid PK, user_id FK→users CASCADE, otp_hash text, expires_at, last_sent_at, created_at; UNIQUE on user_id); `refresh_tokens` (id uuid PK, user_id FK→users CASCADE, token_hash text NOT NULL UNIQUE, expires_at, created_at)
- [ ] T019 [P] [US1] Define Org domain schema in `src/db/schema/org.ts`: `organizations` (id, name, name_lower UNIQUE generated, slug UNIQUE, description NULL, logo_url NULL, quorum_threshold numeric(3,2) default 0.50, onboarding_step enum PENDING_ROLES/PENDING_INVITES/COMPLETE default PENDING_ROLES, archived_at NULL, created_at, updated_at); `roles` (id, org_id FK CASCADE, name, is_owner boolean default false, permissions text[] default '{}', created_at, updated_at; UNIQUE (org_id, lower(name)); partial UNIQUE on org_id WHERE is_owner=true); `memberships` (id, user_id FK CASCADE, org_id FK CASCADE, role_id FK SET NULL, joined_at; UNIQUE (user_id, org_id)); `invitations` (id, org_id FK CASCADE, email citext, role_id FK CASCADE, token_hash UNIQUE, status enum PENDING/ACCEPTED/DECLINED/EXPIRED default PENDING, expires_at, created_at, updated_at; partial UNIQUE (org_id, email) WHERE status='PENDING')
- [ ] T020 [P] [US1] Define Meeting domain schema in `src/db/schema/meeting.ts`: `meetings` (id, org_id FK CASCADE, title, description NULL, location NULL, scheduled_at timestamptz, status enum DRAFT/SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED default DRAFT, created_at, updated_at; index (org_id, status), index scheduled_at); `meeting_agenda_items` (id, meeting_id FK CASCADE, title, description NULL, order_index integer; UNIQUE (meeting_id, order_index)); `meeting_attendees` (meeting_id FK CASCADE, member_id FK→memberships CASCADE; PK composite)
- [ ] T021 [P] [US1] Define Vote domain schema in `src/db/schema/vote.ts`: `votes` (id, meeting_id FK CASCADE, question text, options text[] NOT NULL, status enum OPEN/CLOSED default OPEN, outcome enum NULL PASSED/FAILED/TIED/QUORUM_NOT_MET, result_summary jsonb NULL, deadline timestamptz, closed_at NULL, created_at; index (meeting_id, status)); `vote_eligibility` (vote_id FK CASCADE, member_id FK→memberships CASCADE; PK composite, created_at; insert-only comment); `ballots` (id, vote_id FK CASCADE, member_id FK→memberships CASCADE, choice text NOT NULL, created_at; UNIQUE (vote_id, member_id))
- [ ] T022 [P] [US1] Define Minutes domain schema in `src/db/schema/minutes.ts`: `minutes` (id, meeting_id FK CASCADE UNIQUE, summary NULL, attendance_notes NULL, status enum DRAFT/FINALIZED default DRAFT, finalized_at NULL, created_at, updated_at); `minutes_resolutions` (id, minutes_id FK CASCADE, vote_id FK→votes RESTRICT, description text, created_at; index minutes_id); `minutes_corrections` (id, minutes_id FK CASCADE, content text, created_at; index (minutes_id, created_at); append-only comment)
- [ ] T023 [P] [US1] Define Audit domain schema in `src/db/schema/audit.ts`: `audit_logs` (id uuid PK, org_id uuid NULL, actor_id uuid NULL, event text NOT NULL, entity_type text NOT NULL, entity_id uuid NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL default now(); indexes: (org_id, created_at DESC), (org_id, actor_id), (org_id, event), (org_id, entity_type, entity_id))
- [ ] T024 [US1] Create schema index re-export in `src/db/schema/index.ts` (re-exports all tables and enum types from T018–T023; enables drizzle-kit to discover all tables via single entry point)
- [ ] T025 [US1] Generate initial migration SQL file by running `pnpm db:generate`; verify `src/db/migrations/0000_init.sql` is created and contains all 17 `CREATE TABLE` statements plus `pgcrypto` extension enable and advisory-lock-compatible sequence

### Migration Runner

- [ ] T026 [US1] Create advisory-locked migration runner in `src/shared/database/migrate.ts`: acquires `pg_advisory_lock(5432001)` via raw SQL before calling drizzle-kit's `migrate()`; logs "Acquired migration advisory lock", "Applied migration X", "Released advisory lock"; releases lock in `finally` block; throws `AppError` with `MIGRATION_LOCK_FAILED` if lock cannot be acquired within timeout
- [ ] T027 [US1] Create branded `Tx` type and `withTx` helper in `src/shared/database/transaction.ts` (as specified in `contracts/audit-emitter.md`: `declare const __tx_brand: unique symbol`, `export type Tx = PgTransaction<...> & { [__tx_brand]: true }`, `export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`)

### Health Endpoint

- [ ] T028 [US1] Implement `GET /health` handler in `src/shared/http/health.ts`: runs `SELECT 1` via Drizzle with 1-second timeout; on success returns `{ status: 'ok', timestamp: ISO8601 }` with HTTP 200; on failure returns `{ status: 'degraded', reason: string }` wrapped in error envelope with HTTP 503 (SC-006)
- [ ] T029 [US1] Register `GET /health` route as a Fastify plugin in `src/shared/http/plugin.ts` (uses `fastify.register` pattern; prefix `''`; route requires no auth; response schema matches `contracts/health.openapi.yaml`)

### Server Assembly & Entry Point

- [ ] T030 [US1] Assemble Fastify server instance in `src/server.ts`: configure Pino logger (structured JSON, redact `['req.headers.authorization', '*.password', '*.otp']`); register global error handler using `failure()` envelope; register health plugin; export `buildServer()` factory (no side effects — used by tests and main)
- [ ] T031 [US1] Create application entry point in `src/main.ts` (basic version — env validation added in US3): call `buildServer()`, run `migrate()`, call `app.listen({ port, host })`; log startup success; handle uncaught errors with process.exit(1)

### Tests for User Story 1

- [ ] T032 [US1] Write integration tests for health endpoint in `tests/integration/health.test.ts`: test 1 — GET /health returns 200 with `{ success: true, data: { status: 'ok', timestamp } }` when DB is reachable; test 2 — GET /health returns 503 with error envelope within 2 s when DB is unreachable (stop Postgres mid-test via connection string substitution); verifies SC-006
- [ ] T033 [US1] Write integration test for concurrent migration safety in `tests/integration/migrate.test.ts`: spawns two migration runner calls simultaneously using `Promise.all`; asserts both resolve without error; asserts schema has exactly 17 tables after both complete; asserts no duplicate-table errors; verifies SC-007

**Checkpoint**: `pnpm db:migrate` populates 17 tables. `pnpm dev` starts and `GET /health` returns 200. `pnpm test` passes T032–T033. US1 independently complete.

---

## Phase 4: User Story 2 — Shared Infrastructure Available to Domain Modules (Priority: P1)

**Goal**: Every cross-cutting concern (audit logging, permission enforcement, error formatting, notification delivery, JWT verification) is callable by domain modules as a stable typed interface.

**Independent Test**: Import each module in isolation and call it. Audit emitter commits and rolls back with its parent transaction. Permission guard correctly allows/blocks all 4 access scenarios. Error helpers produce correct envelope shapes. Notification failures produce no thrown errors.

### Permission Set

- [ ] T034 [P] [US2] Create permission set constants in `src/shared/permissions/set.ts` (as specified in `contracts/permission-set.md`: `PERMISSIONS` grouped by domain ORG/ROLE/MEMBER/MEETING/VOTE/MINUTES/AUDIT as `as const satisfies Record<string, readonly string[]>`; export `ALL_PERMISSIONS`, `PermissionKey` union type; total 24 keys including audit:view and audit:export)

### Audit Emitter

- [ ] T035 [P] [US2] Create audit emitter in `src/shared/audit/emitter.ts` (as specified in `contracts/audit-emitter.md`): define `AuditEvent` interface; implement `emitAudit(tx: Tx, event: AuditEvent): Promise<void>`; brand-check at runtime: throw `AppError(INTERNAL_ERROR)` if `tx` is not a `Tx` instance; reject payloads > 64 KiB with a warning log before throwing; insert into `audit_logs` inside the provided transaction

### JWT Verification

- [ ] T036 [P] [US2] Create JWT verification utility in `src/shared/auth/jwt.ts`: export `verifyAccessToken(token: string): Promise<JwtPayload>` using `jose` `jwtVerify`; export `JwtPayload` type `{ sub: string; email: string; iat: number; exp: number }`; throws `AppError(TOKEN_EXPIRED)` or `AppError(INVALID_TOKEN)` on failure; secret sourced from validated config

### Notification Service

- [ ] T037 [P] [US2] Create email-verification template builder in `src/shared/notifications/templates/email-verification.ts` (exports `buildEmailVerificationEmail(payload: { otp: string; expiresInMinutes: number }): { subject: string; text: string }` using the exact body from `contracts/notification-service.md`; no PII in subject)
- [ ] T038 [P] [US2] Create invitation template builder in `src/shared/notifications/templates/invitation.ts` (exports `buildInvitationEmail(payload: { orgName: string; acceptUrl: string; declineUrl: string; expiresAt: string }): { subject: string; text: string }` using the exact body from `contracts/notification-service.md`)
- [ ] T039 [US2] Create Nodemailer transport factory in `src/shared/notifications/transport.ts` (depends on T037, T038): exports `createTransport(config)` returning a Nodemailer transporter; dev config points to Mailpit at `localhost:1025` (no auth); prod config uses `SMTP_HOST/PORT/USER/PASSWORD`; test config uses `nodemailer.createTransport({ jsonTransport: true })` for in-memory capture
- [ ] T040 [US2] Create notification service factory in `src/shared/notifications/service.ts` (depends on T039): implements `NotificationService` interface from `contracts/notification-service.md`; `send()` calls `transport.sendMail()` and catches all errors — logs error fields (redacted: no OTP, no email address) and resolves successfully; callers never see transport errors (SC-005)

### Permission Guard

- [ ] T041 [US2] Implement Fastify permission guard pre-handler hook in `src/shared/permissions/guard.ts` (depends on T034, T036): factory `requirePermission(permission: PermissionKey)` returns a Fastify `preHandler`; extracts Bearer token from `Authorization` header; calls `verifyAccessToken`; queries `memberships JOIN roles` for `(userId, orgId)` from request params; if org does not exist → throws `AppError(FORBIDDEN)` (NOT NOT_FOUND — FR-006 enumeration prevention); if `roles.is_owner = true` → passes unconditionally; if membership lacks `permission` → throws `AppError(FORBIDDEN)`; no result caching (FR-006)

### Unit Tests for User Story 2

- [ ] T042 [US2] Write unit tests for permission set in `tests/unit/shared/permissions/set.test.ts`: assert `ALL_PERMISSIONS.length === 24`; assert `PermissionKey` union includes every key; assert `PERMISSIONS` object is frozen at runtime (immutable check)
- [ ] T043 [US2] Write unit tests for audit emitter in `tests/unit/shared/audit/emitter.test.ts`: assert `emitAudit` throws when passed a non-Tx handle (e.g., the global `db` client); assert `emitAudit` throws when payload exceeds 64 KiB; uses mock Tx object with brand symbol present/absent
- [ ] T044 [US2] Write unit tests for notification service in `tests/unit/shared/notifications/service.test.ts`: assert `send()` resolves successfully even when transport throws; assert `send()` resolves successfully when transport rejects with network error; uses in-memory transport; verifies SC-005
- [ ] T045 [US2] Write unit tests for error envelope helpers in `tests/unit/shared/errors/envelope.test.ts`: assert `success({ id: '1' })` produces `{ success: true, data: { id: '1' } }`; assert `failure(AppError)` produces `{ success: false, error: { code, message, statusCode } }`; assert every error code in `codes.ts` has a corresponding `httpStatus` defined

### Integration Tests for User Story 2

- [ ] T046 [US2] Write integration test for audit emitter transaction rollback in `tests/integration/audit-emitter.test.ts`: inside `withTx`, insert a user row and call `emitAudit`; force rollback by throwing; assert neither the user row nor the audit_log row exist after rollback; verifies SC-003
- [ ] T047 [US2] Write integration tests for permission guard in `tests/integration/permission-guard.test.ts`: 4 scenarios — (1) valid token + sufficient permission → 200; (2) valid token + insufficient permission → 403 FORBIDDEN; (3) expired token → 401 UNAUTHORIZED; (4) Owner role + any permission → 200 unconditional bypass; (5) valid token + nonexistent org → 403 FORBIDDEN (not 404); verifies SC-002
- [ ] T048 [US2] Write integration test for notification delivery failure in `tests/integration/notification.test.ts`: configure service with a transport that always throws; call `send()` on a valid notification template; assert the returned promise resolves (no throw); assert structured error appears in Pino log output; verifies SC-005

**Checkpoint**: All unit and integration tests for US2 pass. Each shared module is callable in isolation. Audit rollback confirmed. Permission guard covers all 5 access scenarios.

---

## Phase 5: User Story 3 — Safe Startup Validation (Priority: P2)

**Goal**: The application refuses to start and identifies failing variables by name when any required environment variable is missing or invalid.

**Independent Test**: Start the application with `JWT_SECRET` removed from `.env` → process exits non-zero within 5 s, prints `JWT_SECRET` as the failing variable. Start with all vars present → server reaches "listening" log line (SC-004).

### Env Config

- [ ] T049 [US3] Create Zod 4.x environment schema and validation in `src/shared/config/env.ts`: define `envSchema` with `z.object({ DATABASE_URL: z.string().url(), JWT_SECRET: z.string().min(32), PORT: z.coerce.number().default(3000), SMTP_HOST: z.string(), SMTP_PORT: z.coerce.number().default(587), SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(), SMTP_FROM: z.string().email(), NODE_ENV: z.enum(['development','production','test']).default('development') })`; export `validateEnv()` that calls `envSchema.safeParse(process.env)` and on failure returns an array of failing field names with their Zod messages; export typed `Env` type from `z.infer<typeof envSchema>`
- [ ] T050 [US3] Create config index re-export in `src/shared/config/index.ts` (exports `validateEnv`, `Env` type, and a module-level `env` singleton that is populated only after `validateEnv()` succeeds — never imported from this module before startup validation)

### Wire Startup Validation into main.ts

- [ ] T051 [US3] Update `src/main.ts` to make env validation the first action: call `validateEnv()`; if it returns failures, log each failing variable name to stderr and call `process.exit(1)`; all subsequent code (migrate, buildServer, listen) uses the validated `env` object; must exit within 5 s of launch (SC-004)

### Tests for User Story 3

- [ ] T052 [US3] Write unit tests for env validation in `tests/unit/shared/config/env.test.ts`: assert `validateEnv()` returns failure array containing `'DATABASE_URL'` when DATABASE_URL is missing; assert it returns `'JWT_SECRET'` when JWT_SECRET is fewer than 32 characters; assert it returns empty array (success) when all required vars are present with valid values; assert `PORT` defaults to 3000 when not set
- [ ] T053 [US3] Write integration test for startup validation in `tests/integration/startup.test.ts`: spawn `node dist/main.js` as a child process with `JWT_SECRET` removed from the environment; assert process exits with non-zero code within 5 s; assert stderr output contains the string `JWT_SECRET`; verifies SC-004

**Checkpoint**: `pnpm dev` exits immediately with clear error when `JWT_SECRET` is removed from `.env`. Restoring `JWT_SECRET` → server starts and logs "listening on http://localhost:3000". US3 independently verified.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final wiring, verification, and quality gates across all user stories.

- [ ] T054 [P] Verify all 9 `pnpm` scripts resolve: `dev` (tsx watch src/main.ts), `build` (tsc), `start` (node dist/main.js), `lint` (eslint src tests), `test` (vitest run), `test:coverage` (vitest run --coverage), `db:generate` (drizzle-kit generate), `db:migrate` (tsx src/shared/database/migrate.ts)
- [ ] T055 [P] Run `pnpm lint` and resolve all warnings/errors to zero (Constitution I gate)
- [ ] T056 Run `pnpm test:coverage` and confirm ≥80% line coverage and ≥80% branch coverage across `src/shared/**` (Constitution II gate)
- [ ] T057 Follow `quickstart.md` end-to-end: install → configure .env → docker compose up → db:migrate → verify 17 tables → pnpm dev → verify startup failure without JWT_SECRET → verify /health 200 → verify /health 503 with Postgres stopped → run pnpm test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T001–T010) — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 — schema, migration, health, server
- **US2 (Phase 4)**: Depends on Phase 2 — can start in parallel with US1 (different files)
- **US3 (Phase 5)**: Depends on Phase 2 + T030/T031 from US1 (updates main.ts)
- **Polish (Phase 6)**: Depends on all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2. No dependency on US2 or US3.
- **US2 (P1)**: Starts after Phase 2. No dependency on US1 or US3.
- **US3 (P2)**: Starts after Phase 2 AND T030+T031 from US1 (main.ts must exist to be updated).

### Within Each Phase

- Schema tasks T018–T023 are all fully parallel (independent files)
- T024 depends on T018–T023 (needs all domain schemas to re-export)
- T025 (`db:generate`) depends on T024
- T026 depends on T011 (Drizzle client)
- T028 depends on T011, T014 (client + envelope)
- T030 depends on T028, T029, T014 (server assembly)
- T031 depends on T026, T030 (migration + server)
- T032–T033 depend on T031 (integration against running app)
- T035 (audit emitter) depends on T027 (Tx type)
- T039 depends on T037, T038 (templates)
- T040 depends on T039 (transport)
- T041 depends on T034, T036 (permission set + JWT)
- T049–T051 form a sequential chain; T051 modifies T031's output

---

## Parallel Example: User Story 1 (Schema Phase)

```bash
# All 6 schema definition tasks can be launched simultaneously:
T018: src/db/schema/auth.ts
T019: src/db/schema/org.ts
T020: src/db/schema/meeting.ts
T021: src/db/schema/vote.ts
T022: src/db/schema/minutes.ts
T023: src/db/schema/audit.ts

# Then sequentially:
T024: src/db/schema/index.ts   (after all 6 complete)
T025: pnpm db:generate         (after T024)
```

## Parallel Example: User Story 2 (Independent Infrastructure)

```bash
# These 5 tasks touch entirely separate files:
T034: src/shared/permissions/set.ts
T035: src/shared/audit/emitter.ts
T036: src/shared/auth/jwt.ts
T037: src/shared/notifications/templates/email-verification.ts
T038: src/shared/notifications/templates/invitation.ts

# Then T039 (transport) after T037+T038
# Then T040 (service) after T039
# Then T041 (permission guard) after T034+T036
```

---

## Implementation Strategy

### MVP First (US1 Only — Minimal Running System)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 — migration + health endpoint
4. **STOP and VALIDATE**: 17 tables in DB, `/health` returns 200, T032–T033 pass
5. Deploy/demo if ready — system stores data and reports its own health

### Incremental Delivery

1. Setup + Foundational → project builds, lint passes
2. US1 → database exists, health works, migration is safe → deploy as skeleton
3. US2 → all shared infrastructure callable → domain modules can now be built
4. US3 → startup is safe in any environment → production-ready
5. Polish → quality gates pass → branch ready to merge

### Parallel Team Strategy

With two developers after Phase 2 completes:

- **Developer A**: US1 (T018–T033) — schema, migration, health
- **Developer B**: US2 (T034–T048) — audit, permissions, notifications, JWT

Both complete independently. US3 is sequential (modifies main.ts after US1 ships it).

---

## Task Summary

| Phase                 | Tasks        | Parallel Tasks   | Description            |
| --------------------- | ------------ | ---------------- | ---------------------- |
| Phase 1: Setup        | T001–T010    | T003–T007, T009  | Project scaffolding    |
| Phase 2: Foundational | T011–T017    | T011–T013, T016  | Core infrastructure    |
| Phase 3: US1          | T018–T033    | T018–T023        | DB deployment + health |
| Phase 4: US2          | T034–T048    | T034–T038        | Shared infrastructure  |
| Phase 5: US3          | T049–T053    | —                | Startup validation     |
| Phase 6: Polish       | T054–T057    | T054–T055        | Quality gates          |
| **Total**             | **57 tasks** | **~20 parallel** |                        |

### Success Criteria Traceability

| SC                                           | Test Task(s)                    |
| -------------------------------------------- | ------------------------------- |
| SC-001 (17 tables from blank DB)             | T033 (migrate.test.ts)          |
| SC-002 (permission guard 100% scenarios)     | T047 (permission-guard.test.ts) |
| SC-003 (audit rollback)                      | T046 (audit-emitter.test.ts)    |
| SC-004 (startup refuses with bad env, ≤5 s)  | T053 (startup.test.ts)          |
| SC-005 (notification failure not propagated) | T044, T048                      |
| SC-006 (health 503 within 2 s)               | T032 (health.test.ts)           |
| SC-007 (concurrent migration safety)         | T033 (migrate.test.ts)          |
