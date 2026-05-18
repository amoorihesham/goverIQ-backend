# Implementation Plan: Audit, Hardening & Deployment

**Branch**: `006-audit-hardening-deployment` | **Date**: 2026-05-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/006-audit-hardening-deployment/spec.md`

## Summary

Phase 5 — the final phase. Build the **Audit** module (`src/modules/audit/`) —
the 8th and last domain module — exposing two read-only, organization-scoped
endpoints: an audit-log **query** (cursor-paginated, filtered) and an audit-log
**export** (CSV or PDF, unbounded, streamed). Both run sensitive payload fields
through a shared **read-time redaction** step. Then harden the system for
production: a database **append-only trigger** on `audit_logs`, a central
**29-event registry** that type-checks every emitter and verifies completeness,
spec-compliant **health endpoints**, **secret-length** validation and a rewritten
**`.env.example`**, complete **API documentation**, a production **Dockerfile**,
and a **structured-logging** sweep.

The Audit module follows the flat-route, factory-function conventions of
`meetings` / `votes` / `minutes`. `audit:view` and `audit:export` already exist
in the 22-key permission set; no new permission is added. **No new database
table and no column change** — one additive, non-destructive migration
(`0004_audit_append_only.sql`) installs the trigger. **No new runtime
dependency** — CSV export is hand-rolled and PDF reuses the already-installed
`pdfkit`. The feature satisfies all 20 functional requirements (FR-501 … FR-520)
and all 17 success criteria (SC-501 … SC-515, incl. SC-504a).

> **Rate limiting is delegated to an external API gateway** and is intentionally
> absent from application code (spec clarification 2026-05-17, research
> [Decision 9](./research.md)). FR-510/FR-511 are satisfied by gateway
> configuration documented in [contracts/deployment.md](./contracts/deployment.md),
> not by code.

> **Task zero — repository hygiene, not a design decision:** `src/app.ts` and
> `src/shared/audit/emitter.ts` carry **committed, unresolved git merge-conflict
> markers**; the project does not compile until they are removed. Resolving them
> (keep the `meetings`/`votes` registrations; keep the clean emitter body) is the
> precondition for every task below. See research.md.

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js 24 LTS (unchanged).
**Primary Dependencies**: Fastify 5.8.x, Drizzle ORM, Zod 4.x, Pino,
`fastify-type-provider-zod`, `@fastify/helmet`, `@fastify/swagger`, `pdfkit` —
**all already installed**. **No new runtime dependency**: CSV is hand-rolled
(research [Decision 5](./research.md)); PDF reuses `pdfkit`.
**Storage**: existing `audit_logs` Postgres table (feature 001), read-only.
**One additive migration** — `0004_audit_append_only.sql` — installs a
`BEFORE UPDATE OR DELETE` trigger; it creates no table and alters no column
(research [Decision 4](./research.md), [data-model.md](./data-model.md)).
**Testing**: Vitest (unit + integration). Integration helper
`tests/integration/helpers/db.ts` gains `truncateAuditTables()`.
**Target Platform**: Linux server / Node.js 24, containerized via a new
multi-stage `Dockerfile`, stateless, multi-replica-ready.
**Project Type**: Backend web service — modular monolith. `src/modules/audit/`
is the 8th and final domain module.
**Performance Goals**: Audit query p95 < 200 ms against an org with ≥ 100,000
entries (Constitution IV, SC-514). The hot path is a keyset query on
`audit_logs_org_created_idx` with every filter column index-backed (feature-001
indexes — research [Decision 2](./research.md)); export reads in bounded keyset
batches and streams, so memory is bounded by one batch regardless of total size
(SC-504, research [Decision 6](./research.md)).
**Constraints**: Every query and export is hard-scoped to the path `:orgId`; no
filter or cursor can widen scope (FR-503). Redaction is **read-time only** — the
stored `audit_logs` row is never mutated, and query and export call the
**identical** redaction function (FR-504a). `audit_logs` is append-only at the
**data store** after migration `0004` (FR-507). Reading the audit log is **not**
itself audited — no new audit event. Permission resolution is per-request from
the DB — no caching.
**Scale/Scope**: 2 protected routes (1 new module), 1 additive migration
(trigger), 2 new shared modules (`redact.ts`, `events.ts`), 0 new dependencies,
0 new permissions, 0 new error codes, 0 new audit events, 1 new `Dockerfile`,
1 new `gen-openapi.ts` script, edits to `env.ts` / `.env.example` /
`http/plugin.ts` / `app.ts` / `main.ts`, plus the merge-conflict resolution.
≈ 14 new source files plus tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Status | Gate Verification                                                                                                                                                                                                                                                |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Code Quality              | Pass   | Audit module split into routes / controller / service / schemas / types / constants / utils; redaction and the event registry are pure shared modules; CSV and PDF writers isolated in `utils/`; deny-list, batch size and page sizes are named constants; lint + Prettier enforced |
| II. Testing Standards        | Pass   | Unit tests cover `redactAuditPayload` (deep, non-mutating, deny-list) and the `AUDIT_EVENTS` registry (exactly 29); integration tests cover query/filter/scope, CSV+PDF export, append-only rejection, rollback, and 29-event completeness; coverage ≥ 80%; TDD enforced |
| III. API Design Consistency  | Pass   | Both routes use the existing success/error envelope (export is the documented file-stream exception); all errors use existing registry codes — **no new code**; 1 OpenAPI contract + 2 internal contracts authored before any handler; cursor pagination matches the Phase 0 convention |
| IV. Performance Requirements | Pass   | Query is a keyset scan on `audit_logs_org_created_idx`; every filter column is covered by a feature-001 index; export streams bounded keyset batches — no full-table load, no N+1; p95 < 200 ms target verified against ≥ 100,000 entries (SC-514) |

**Pre-design Constitution Check: PASS.** No principle is violated. Two items
touch the Technical Standards section and are handled in compliance with it: the
additive `0004` trigger migration (one-time, additive, non-destructive — research
Decision 4) and the new `Dockerfile` (no new dependency; pins `node:24` — research
Decision 10). The merge-conflict resolution is repository hygiene that *restores*
a compiling, lint-clean state. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/006-audit-hardening-deployment/
├── plan.md              # This file
├── research.md          # Phase 0 output — 13 technical decisions
├── data-model.md        # Phase 1 output — audit_logs read map + the one migration
├── quickstart.md        # Phase 1 output — end-to-end verification walkthrough
├── contracts/
│   ├── audit.openapi.yaml      # 2 audit endpoints (query + export)
│   ├── audit-redaction.md      # Internal contract: deny-list + redaction function
│   └── deployment.md           # Internal contract: gateway, headers, health, container, config
└── tasks.md             # Phase 2 output (NOT created here — /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── db/
│   └── migrations/
│       └── 0004_audit_append_only.sql   # NEW — append-only trigger on audit_logs
├── modules/
│   └── audit/                           # NEW — 8th and final domain module
│       ├── public.ts                    # exports auditRoutes
│       ├── audit.routes.ts              # 2 endpoints + pre-handler wiring
│       ├── audit.controller.ts          # createAuditController(db) factory
│       ├── audit.service.ts             # auditService(db) — query + streamed export
│       ├── schemas/
│       │   └── zod.ts                   # query/export request + response schemas
│       ├── types/
│       │   └── request.ts               # typed params / query
│       ├── constants/
│       │   └── index.ts                 # page-size + export-batch-size constants
│       └── utils/
│           ├── csv.ts                   # renderAuditCsv — hand-rolled, no Fastify/DB
│           └── pdf.ts                   # renderAuditPdf — pdfkit, no Fastify/DB
├── shared/
│   └── audit/
│       ├── redact.ts                    # NEW — AUDIT_REDACTION_DENYLIST + redactAuditPayload
│       ├── events.ts                    # NEW — AUDIT_EVENTS registry (29) + AuditEventName
│       ├── emitter.ts                   # EDIT — remove merge-conflict markers
│       └── types.ts                     # EDIT — AuditEvent.event: string → AuditEventName
├── scripts/
│   └── gen-openapi.ts                   # NEW — emits the OpenAPI doc (gen:openapi script)
├── shared/
│   ├── config/env.ts                    # EDIT — .min(32) on JWT secrets
│   └── http/plugin.ts                   # EDIT — health timestamps; remove /protected
├── app.ts                               # EDIT — resolve conflict; register auditRoutes; Audit tag; conditional HSTS
└── main.ts                              # EDIT — shutdown logging console.error → logger

tests/
├── unit/
│   └── shared/audit/
│       ├── redact.test.ts               # deny-list, deep, non-mutating
│       └── events.test.ts               # AUDIT_EVENTS holds exactly 29
└── integration/
    ├── helpers/
    │   └── db.ts                        # ADD truncateAuditTables()
    └── modules/audit/
        ├── helpers.ts                   # seed an audited history for an org
        ├── audit-query.test.ts          # US1 — FR-501..504, scope, pagination
        ├── audit-redaction.test.ts      # FR-504a / SC-504a — query + export parity
        ├── audit-export.test.ts         # US2 — FR-505/FR-506 — CSV + PDF
        └── audit-integrity.test.ts      # US3 — FR-507..509 — append-only, rollback, 29 events

# Repository root (deployment)
Dockerfile                               # NEW — multi-stage production image
.dockerignore                            # REVIEW/EXTEND
.env.example                             # REWRITE — authoritative config reference
```

**Structure Decision**: Single-project modular monolith — unchanged since
Phase 0. `audit` is delivered as the 8th independent module, mirroring the
`votes` / `minutes` layout (controller / service / routes / schemas / types /
constants / utils). The audit *emitter* stays in `src/shared/audit/` — it is
cross-cutting infrastructure called by every writing module — and gains two pure
sibling modules (`redact.ts`, `events.ts`). No repository file: the service
queries Drizzle directly, consistent with `meetings` / `votes` / `minutes`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. This section is intentionally empty.

---

## Implementation Notes

### Task zero — resolve the committed merge conflicts

`src/app.ts` (lines ~11–22, 19–22) and `src/shared/audit/emitter.ts` (lines
~10–13) contain `<<<<<<<` / `=======` / `>>>>>>>` markers. Resolution: keep the
HEAD side in `app.ts` (the `meetings` and `votes` route imports/registrations
are real and used) and keep the clean body of `emitter.ts`. After resolution,
`pnpm type-check` and `pnpm lint` MUST pass before any feature code is added.

### Audit module route shapes (research Decision 1)

Flat routes, consistent with `meetings` / `votes` / `minutes`:

| Method & path                            | Permission     | Pre-handlers                                             |
| ----------------------------------------- | -------------- | -------------------------------------------------------- |
| `GET /api/v1/audit/org/:orgId`            | `audit:view`   | `identityRequired → attachOrgId → requirePermission`     |
| `GET /api/v1/audit/org/:orgId/export`     | `audit:export` | `identityRequired → attachOrgId → requirePermission`     |

`requireOnboardingStep` is **deliberately not** in the chain — the audit log is a
compliance read surface that must remain available at any onboarding step and
for archived orgs (research Decision 1).

### Audit query (FR-501 … FR-504)

`audit.service.ts` builds one Drizzle `SELECT` on `audit_logs`:

1. Base predicate `eq(auditLogs.orgId, orgId)` — never optional (FR-503).
2. Optional `AND` predicates per supplied filter: `actorId`, `event`,
   `entityType`, `entityId`, `from` (`gte(createdAt)`), `to` (`lte(createdAt)`).
3. Keyset predicate via `applyKeysetWhere(auditLogs.createdAt, auditLogs.id,
   cursor, 'desc')`; order `createdAt DESC, id DESC`; `limit + 1` to detect a
   next page; `nextCursor = encodeCursor(...)` from the last kept row.
4. Each row's `payload` passes through `redactAuditPayload` before it enters the
   response (contracts/audit-redaction.md).

`from > to` is not an error — the predicates simply match nothing. A malformed or
foreign cursor is rejected by `decodeCursor` as `VALIDATION_ERROR`; because the
`org_id` predicate always ANDs in, a cursor cannot leak a foreign row.

### Audit export (FR-505 / FR-506, research Decisions 5 & 6)

`?format` (`csv` default, `pdf`) validated by Zod — any other value →
`VALIDATION_ERROR`. The service reads the filtered set in keyset batches (batch
size in `constants/index.ts`) using the **same** ordering and predicates as the
query, redacts each row, and streams:

- **CSV** — `renderAuditCsv` (`utils/csv.ts`, hand-rolled RFC-4180 quoting, no
  Fastify/DB import) writes a header then row batches to `reply.raw`.
- **PDF** — `renderAuditPdf` (`utils/pdf.ts`, `pdfkit`, no Fastify/DB import)
  pipes a document to `reply.raw`.

Headers: `Content-Type` `text/csv` / `application/pdf`;
`Content-Disposition: attachment; filename="audit-<orgId>-<ISO>.<ext>"`. A
zero-match filter set still emits a well-formed file. Export and query return
provably identical entries for an identical filter set (FR-506).

### Read-time redaction (FR-504a — contracts/audit-redaction.md)

`src/shared/audit/redact.ts` exports the frozen `AUDIT_REDACTION_DENYLIST` and
the pure `redactAuditPayload`. Both the query path and the export path call it;
neither defines its own list. The emitter is **not** touched — stored payloads
keep every field.

### Append-only enforcement (FR-507 — migration 0004)

`0004_audit_append_only.sql` installs a `BEFORE UPDATE OR DELETE` trigger on
`audit_logs` that raises an exception, plus `REVOKE UPDATE, DELETE … FROM PUBLIC`
for defence in depth (research Decision 4, data-model.md §2). The trigger fires
for the table owner too, so it holds against the application's own credentials —
the guarantee is enforced "by the data store, not merely by application code".

### Audit-event registry & completeness (FR-508 — research Decision 7)

`src/shared/audit/events.ts` defines the frozen `AUDIT_EVENTS` array of the **29**
event strings and the `AuditEventName` union; `types.ts` retypes
`AuditEvent.event` to `AuditEventName`, so every `emitAudit` call is
compiler-checked. `audit-integrity.test.ts` runs the full governance flow and
asserts all 29 appear exactly once; `events.test.ts` asserts the registry length
is 29. Background-job emitters (`system.cleanup` from the queue cleanup jobs) are
verified to call `emitAudit` inside a `withTx` block (FR-509).

### Hardening edits

- **Health** (`src/shared/http/plugin.ts`) — `/health/live` returns
  `{ status:'live', timestamp }` (no probe); `/health/ready` returns
  `{ status:'ready', timestamp }` / `503 { status:'unavailable', timestamp }`;
  the stray `/protected` route is removed (research Decision 8).
- **Security headers** (`src/app.ts`) — helmet `noSniff` + `frameguard:'deny'`
  stay; the `hsts` option is gated to `env.NODE_ENV === 'production'` (FR-512).
- **Env** (`src/shared/config/env.ts`) — `JWT_ACCESS_SECRET` and
  `JWT_REFRESH_SECRET` get `.min(32)` (FR-515). `.env.example` is rewritten to
  the authoritative variable list (contracts/deployment.md §6, FR-518).
- **Logging** (`src/main.ts`) — the shutdown-timeout `console.error` becomes
  `logger.error`; `env.ts`'s pre-logger `console.error` is kept as a documented
  exception (FR-520, research Decision 13).

### Deployment

- **`Dockerfile`** — multi-stage `node:24` builder (`pnpm build`) → `node:24-slim`
  runtime; copies `dist/` and `src/db/migrations/`; entrypoint
  `node --import ./dist/tracing.js ./dist/main.js` (research Decision 10).
  `docker-compose.yml` stays a dev-infra bundle.
- **API docs** (`src/app.ts` + `src/scripts/gen-openapi.ts`) — add the `Audit`
  tag and `audit` → `Audit` to `tagBySegment`; create the missing
  `gen-openapi.ts` the `gen:openapi` script references; ensure every route
  schema documents request, success, and all error responses (FR-519).

### app.ts registration

```ts
// resolved import block keeps meetings + votes; add:
import { auditRoutes } from '@/modules/audit/public';
// tagBySegment: add  audit: 'Audit'
// swagger tags: add  { name: 'Audit', description: 'Audit log query and export' }
// in the /api/v1 scope:
await instance.register(auditRoutes, { prefix: '/audit' });
```

### Test helper addition

```ts
// tests/integration/helpers/db.ts
export async function truncateAuditTables(): Promise<void> {
  await db.execute(sql`TRUNCATE audit_logs RESTART IDENTITY`);
}
```

`modules/audit/helpers.ts` seeds an org with a known audited history (reusing the
auth/org/meeting helpers) so query, redaction, export, and completeness tests run
against deterministic data.

---

## Post-Design Constitution Re-check

After generating `research.md`, `data-model.md`, `contracts/`, and
`quickstart.md`:

| Principle                    | Status | Notes                                                                                                                                                                            |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Code Quality              | Pass   | `redact.ts` and `events.ts` are pure shared modules; CSV/PDF writers isolated, no Fastify/DB import; single responsibility per file; deny-list, batch size, page sizes are named constants |
| II. Testing Standards        | Pass   | 2 unit files (redaction, registry) + 4 integration files cover every FR/SC, including append-only rejection, rollback, and 29-event completeness; coverage ≥ 80%                  |
| III. API Design Consistency  | Pass   | 1 OpenAPI contract + 2 internal contracts authored before implementation; routes use the existing envelope (export is the documented file-stream exception); zero new error codes |
| IV. Performance Requirements | Pass   | Query is a keyset scan on an existing index; every filter column is index-backed; export streams bounded batches — no full load, no N+1; SC-514 verified at ≥ 100,000 entries     |

**Post-design Constitution Check: PASS.** Ready for `/speckit-tasks`.
