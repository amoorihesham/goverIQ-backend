---
description: 'Task list for Audit, Hardening & Deployment'
---

# Tasks: Audit, Hardening & Deployment

**Input**: Design documents from `specs/006-audit-hardening-deployment/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test tasks ARE included — the project constitution mandates TDD
(Principle II) and the plan specifies unit + integration test files. Within each
phase, write the test task(s) first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story. Priority order is P1 (US1,
US3) → P2 (US2, US4) → P3 (US5).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1–US5, mapping to the spec's user stories
- Every task names exact file paths

## Path Conventions

Single-project modular monolith — `src/` and `tests/` at the repository root.

---

## Phase 1: Setup

**Purpose**: Repository hygiene and audit-module scaffolding before any feature work.

- [X] T001 Resolve the committed git merge-conflict markers in `src/app.ts` (keep the `meetings`/`votes` route imports and registrations) and `src/shared/audit/emitter.ts` (keep the clean function body); confirm `pnpm type-check` and `pnpm lint` both pass before continuing
- [X] T002 [P] Create the `src/modules/audit/` module skeleton — `public.ts`, `constants/index.ts` (named constants: default page size 20, max page size 100, export keyset batch size), and empty `schemas/`, `types/`, `utils/` folders — per the structure in plan.md
- [X] T003 [P] Add `truncateAuditTables()` (`TRUNCATE audit_logs RESTART IDENTITY`) to `tests/integration/helpers/db.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared code used by more than one user story — the read-time
redaction module (US1 query + US2 export) and the audit integration helper.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Write the unit test `tests/unit/shared/audit/redact.test.ts` — assert `redactAuditPayload` is deep (nested deny-list keys removed), non-mutating (input unchanged), total (accepts objects/arrays/primitives/null), and drops every key in `AUDIT_REDACTION_DENYLIST`; confirm it FAILS
- [X] T005 Implement `src/shared/audit/redact.ts` — the frozen `AUDIT_REDACTION_DENYLIST` constant and the pure `redactAuditPayload` function per [contracts/audit-redaction.md](./contracts/audit-redaction.md); make T004 pass
- [X] T006 [P] Create `tests/integration/modules/audit/helpers.ts` — seed an organization with a deterministic audited history (reuse the auth/org/meeting helpers) for the audit query, redaction, export, and integrity tests

**Checkpoint**: Foundation ready — user stories can now proceed.

---

## Phase 3: User Story 1 - Query the organization audit log (Priority: P1) 🎯 MVP

**Goal**: A member with `audit:view` retrieves their org's audit log, newest-first, cursor-paginated, narrowed by AND-combined filters.

**Independent Test**: Exercise an audited flow, then `GET /api/v1/audit/org/:orgId`; confirm entries return with actor/event/entity/payload/timestamp, each filter narrows correctly, pages have no gaps/duplicates, a non-`audit:view` caller gets `FORBIDDEN`, and another org's entries never appear.

### Tests for User Story 1

- [X] T007 [P] [US1] Write `tests/integration/modules/audit/audit-query.test.ts` — newest-first ordering, every filter (`actorId`, `event`, `entityType`, `entityId`, `from`, `to`) individually and combined, cursor pagination with no gaps/duplicates, `from > to` → empty list, malformed/foreign cursor → `VALIDATION_ERROR`, missing `audit:view` → `FORBIDDEN`, cross-org isolation; confirm it FAILS

### Implementation for User Story 1

- [X] T008 [P] [US1] Add the query request schema (optional filters, `cursor`, `limit` 1–100 default 20) and the paginated response schema (`entries[]` + `nextCursor`) to `src/modules/audit/schemas/zod.ts`
- [X] T009 [P] [US1] Add the typed query params/request types to `src/modules/audit/types/request.ts`
- [X] T010 [US1] Implement `auditService(db).query(...)` in `src/modules/audit/audit.service.ts` — base `eq(orgId)` predicate (FR-503), optional AND filter predicates, keyset paging via `applyKeysetWhere` on `(createdAt DESC, id)`, `limit + 1` next-page detection, `encodeCursor` for `nextCursor`, and `redactAuditPayload` on each row's payload (depends on T005, T008, T009)
- [X] T011 [US1] Implement `queryAuditLog` in `src/modules/audit/audit.controller.ts` via a `createAuditController(db)` factory, returning the standard success envelope (depends on T010)
- [X] T012 [US1] Wire `GET /org/:orgId` in `src/modules/audit/audit.routes.ts` with pre-handlers `identityRequired → attachOrgId → requirePermission('audit:view')` (no onboarding gate — research Decision 1), and export `auditRoutes` from `src/modules/audit/public.ts` (depends on T011)
- [X] T013 [US1] Register `auditRoutes` under prefix `/audit` in `src/app.ts`, add `audit: 'Audit'` to `tagBySegment`, and add `{ name: 'Audit', description: 'Audit log query and export' }` to the swagger `tags` array (depends on T012)

**Checkpoint**: The audit query endpoint is fully functional and independently testable — MVP.

---

## Phase 4: User Story 3 - A complete and tamper-proof audit trail (Priority: P1)

**Goal**: Every state-changing operation emits exactly one of the 29 registered audit events, and no audit row can be updated or deleted through the application.

**Independent Test**: Run the full governance flow and confirm all 29 event types appear, each operation producing one entry; force a mid-transaction failure and confirm no entry survives the rollback; attempt `UPDATE`/`DELETE` on `audit_logs` with the app's DB credentials and confirm the data store rejects both.

### Tests for User Story 3

- [X] T014 [P] [US3] Write `tests/unit/shared/audit/events.test.ts` — assert `AUDIT_EVENTS` contains exactly 29 distinct entries; confirm it FAILS
- [X] T015 [P] [US3] Write `tests/integration/modules/audit/audit-integrity.test.ts` — `UPDATE`/`DELETE` on `audit_logs` rejected by Postgres (`audit_logs is append-only`), a forced mid-transaction rollback leaves zero audit rows, and the full governance flow yields all 29 distinct events with one entry per operation; confirm it FAILS

### Implementation for User Story 3

- [X] T016 [P] [US3] Create `src/shared/audit/events.ts` — the frozen `AUDIT_EVENTS` array of the 29 event strings and the `AuditEventName` union type per [data-model.md](./data-model.md) §4; make T014 pass
- [X] T017 [US3] Retype `AuditEvent.event` from `string` to `AuditEventName` in `src/shared/audit/types.ts`, then fix any resulting compile errors at the `emitAudit` call sites across all modules (depends on T016)
- [X] T018 [P] [US3] Create `src/db/migrations/0004_audit_append_only.sql` — the `audit_logs_append_only()` function, the `BEFORE UPDATE OR DELETE` trigger on `audit_logs`, and `REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC` per [data-model.md](./data-model.md) §2; update the drizzle migration journal so `runMigrations` applies it
- [X] T019 [US3] Verify the queue-job `emitAudit` calls (`system.cleanup` in `src/shared/queue/jobs/cleanup-otps.ts`, `cleanup-refresh.ts`, `expire-invites.ts`) run inside a `withTx` block; wrap any that do not (FR-509)

**Checkpoint**: The audit trail is provably complete and tamper-proof at the data-store level.

---

## Phase 5: User Story 2 - Export the audit log (Priority: P2)

**Goal**: A member with `audit:export` downloads the complete filtered audit log as CSV or PDF, unbounded and streamed.

**Independent Test**: Build an audit history, export with a filter set in each format, and confirm the file is well-formed and contains exactly the entries the equivalent query returns across all pages; an unsupported format is rejected; a zero-match filter still yields a valid file; a non-`audit:export` caller gets `FORBIDDEN`.

### Tests for User Story 2

- [X] T020 [P] [US2] Write `tests/integration/modules/audit/audit-export.test.ts` — CSV export is a valid flat file, PDF export is a valid `%PDF` document, both contain exactly the entries the query returns for an identical filter set (no page cap), `?format=xlsx` → `VALIDATION_ERROR`, a zero-match filter yields a well-formed file (CSV header only), missing `audit:export` → `FORBIDDEN`; confirm it FAILS
- [X] T021 [P] [US2] Write `tests/integration/modules/audit/audit-redaction.test.ts` — seed payloads carrying deny-list fields, then assert neither the query nor the export returns any deny-list key, the stored `audit_logs.payload` still contains them, and query/export return identical redacted payloads for the same filter set (FR-504a, SC-504a); confirm it FAILS

### Implementation for User Story 2

- [X] T022 [P] [US2] Implement `renderAuditCsv` in `src/modules/audit/utils/csv.ts` — hand-rolled RFC-4180 quoting, header + incremental row batches, no Fastify/DB import
- [X] T023 [P] [US2] Implement `renderAuditPdf` in `src/modules/audit/utils/pdf.ts` — `pdfkit` document, no Fastify/DB import, following `src/modules/minutes/utils/pdf.ts`
- [X] T024 [P] [US2] Add the export request schema (`format` enum `csv`|`pdf` default `csv`, same filters minus `cursor`/`limit`) to `src/modules/audit/schemas/zod.ts` and the export request types to `src/modules/audit/types/request.ts`
- [X] T025 [US2] Implement `auditService(db).export(...)` in `src/modules/audit/audit.service.ts` — read the filtered set in keyset batches reusing the query predicates/ordering, apply `redactAuditPayload` per row, feed batches to the chosen formatter (depends on T005, T022, T023, T024)
- [X] T026 [US2] Implement `exportAuditLog` in `src/modules/audit/audit.controller.ts` — stream to `reply.raw` with `Content-Type` (`text/csv`/`application/pdf`) and `Content-Disposition: attachment; filename="audit-<orgId>-<ISO>.<ext>"` (depends on T025)
- [X] T027 [US2] Wire `GET /org/:orgId/export` in `src/modules/audit/audit.routes.ts` with pre-handlers `identityRequired → attachOrgId → requirePermission('audit:export')` (depends on T026)

**Checkpoint**: Audit query AND export both work independently.

---

## Phase 6: User Story 4 - Abuse-resistant authentication and hardened responses (Priority: P2)

**Goal**: Auth endpoints are rate-limited at the API gateway (no app code) and every application response carries defensive browser headers.

**Independent Test**: Inspect any application response and confirm `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` are present, with `Strict-Transport-Security` present only under `NODE_ENV=production`. Gateway rate-limit behavior is verified against the deployed gateway, not the app.

### Tests for User Story 4

- [X] T028 [P] [US4] Write `tests/integration/modules/health/security-headers.test.ts` — assert every response carries `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`, and that `Strict-Transport-Security` is absent in test/dev; confirm it FAILS

### Implementation for User Story 4

- [X] T029 [US4] Gate the `@fastify/helmet` `hsts` option to `env.NODE_ENV === 'production'` in `src/app.ts`, keeping `noSniff` and `frameguard: { action: 'deny' }` unconditional (FR-512); confirm no `@fastify/rate-limit` dependency or rate-limit code exists — rate limiting stays delegated to the gateway per [contracts/deployment.md](./contracts/deployment.md)

**Checkpoint**: Responses are hardened; rate limiting is documented as gateway config.

---

## Phase 7: User Story 5 - Deployable, observable, and documented system (Priority: P3)

**Goal**: The system starts from a blank environment with documented config, exposes liveness/readiness probes, refuses to start misconfigured, is containerized, and ships complete API docs and structured logs.

**Independent Test**: From a clean environment, supply the documented config, start the system, and confirm migrations apply and health reports success; remove a required value (or shorten a secret) and confirm the system refuses to start.

### Tests for User Story 5

- [X] T030 [P] [US5] Write `tests/integration/modules/health/health.test.ts` — `/health/live` returns `200 { status:'live', timestamp }` with no DB probe, `/health/ready` returns `200 { status:'ready', timestamp }` when the DB is reachable and `503 { status:'unavailable', timestamp }` when it is not, both unauthenticated; confirm it FAILS

### Implementation for User Story 5

- [X] T031 [US5] Update `src/shared/http/plugin.ts` — `/health/live` returns `{ status:'live', timestamp }` (no probe), `/health/ready` returns `{ status:'ready'|'unavailable', timestamp }` with 200/503, both with ISO-8601 timestamps; remove the stray `GET /protected` route (FR-513)
- [X] T032 [P] [US5] Add `.min(32)` to `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in the Zod schema in `src/shared/config/env.ts` (FR-515)
- [X] T033 [P] [US5] Rewrite `.env.example` as the authoritative configuration reference — every variable the `env.ts` schema reads, each with a comment stating purpose and required/default, per [contracts/deployment.md](./contracts/deployment.md) §6 (FR-518)
- [X] T034 [P] [US5] Replace the shutdown-timeout `console.error` in `src/main.ts` with `logger.error` (FR-520)
- [X] T035 [P] [US5] Create `src/scripts/gen-openapi.ts` — boot the app and emit the generated OpenAPI document to a file, matching the existing `gen:openapi` package script path
- [X] T036 [US5] Audit every route's Zod schema (all modules) for complete request/success/error-response shapes and `summary` text so `@fastify/swagger` documents all endpoints including the two audit routes (FR-519)
- [X] T037 [P] [US5] Create a multi-stage `Dockerfile` at the repo root (`node:24` builder running `pnpm build` → `node:24-slim` runtime with prod deps, `dist/`, and `src/db/migrations/`; entrypoint `node --import ./dist/tracing.js ./dist/main.js`) and review/extend `.dockerignore` per [contracts/deployment.md](./contracts/deployment.md) §4

**Checkpoint**: The system is deployable, observable, and fully documented.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories.

- [X] T038 [P] Sweep all production code paths for `console.*` calls — confirm none remain except the documented pre-logger `console.error` in `src/shared/config/env.ts` (FR-520, SC-515)
- [X] T039 Run `pnpm lint`, `pnpm type-check`, and `pnpm format:check` — fix every warning
- [ ] T040 [P] Run `pnpm test:coverage` — confirm line coverage stays ≥ 80% (Constitution II)
- [ ] T041 Execute the [quickstart.md](./quickstart.md) walkthrough end-to-end, including the container build, and confirm every step passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T001 blocks everything (the project must compile).
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phases 3–7)**: All depend on Foundational. Proceed in priority order P1 → P2 → P3, or in parallel if staffed.
- **Polish (Phase 8)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational. No dependency on other stories.
- **US3 (P1)**: Starts after Foundational. Independent of US1 (touches the emitter/registry/migration, not the audit module's read path).
- **US2 (P2)**: Starts after Foundational. Shares `audit.service.ts`/`audit.routes.ts`/`schemas/zod.ts` with US1 — best done after US1, but the export path is independently testable.
- **US4 (P2)**: Starts after Foundational. Fully independent (touches `app.ts` helmet config only).
- **US5 (P3)**: Starts after Foundational. Fully independent (health, env, docs, container).

### Within Each User Story

- Test task(s) written first and failing before implementation.
- Schemas/types before services; services before controllers; controllers before routes.
- US1: T007 first → T008, T009 [P] → T010 → T011 → T012 → T013.
- US3: T014, T015 first → T016 → T017; T018, T019 independent.
- US2: T020, T021 first → T022, T023, T024 [P] → T025 → T026 → T027.

### File-contention notes (not parallel with each other)

- `src/app.ts`: T001 → T013 → T029 (sequential).
- `src/modules/audit/schemas/zod.ts`: T008 → T024.
- `src/modules/audit/audit.service.ts`: T010 → T025.
- `src/modules/audit/audit.routes.ts`: T012 → T027.
- `src/modules/audit/audit.controller.ts`: T011 → T026.

---

## Parallel Execution Examples

```bash
# Phase 1 Setup — after T001:
Task T002: "Create src/modules/audit/ skeleton + constants"
Task T003: "Add truncateAuditTables() to tests/integration/helpers/db.ts"

# Phase 3 US1 — after the failing test T007:
Task T008: "Query request/response Zod schemas in schemas/zod.ts"
Task T009: "Typed query params in types/request.ts"

# Phase 5 US2 — after the failing tests T020, T021:
Task T022: "renderAuditCsv in utils/csv.ts"
Task T023: "renderAuditPdf in utils/pdf.ts"
Task T024: "Export request schema + types"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup — resolve merge conflicts, scaffold the module.
2. Phase 2: Foundational — redaction module + helper.
3. Phase 3: US1 — the audit query endpoint.
4. **STOP and VALIDATE**: the audit log is observable through the API.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 (query) → test → demo (**MVP**).
3. US3 (tamper-proof trail) → test → demo.
4. US2 (export) → test → demo.
5. US4 (hardened responses) → test → demo.
6. US5 (deployable/observable/documented) → test → demo.
7. Phase 8 polish → final verification.

### Parallel Team Strategy

After Foundational completes: Developer A on US1→US2 (the audit module),
Developer B on US3 (emitter/registry/migration), Developer C on US4+US5
(hardening + deployment). The three tracks touch mostly disjoint files — only
`app.ts` needs coordination (T013 then T029).

---

## Notes

- 41 tasks total: Setup 3, Foundational 3, US1 7, US3 6, US2 8, US4 2, US5 8, Polish 4.
- [P] = different files, no dependency on an incomplete task.
- This feature adds no new database table, column, runtime dependency, permission, error code, or audit event.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
