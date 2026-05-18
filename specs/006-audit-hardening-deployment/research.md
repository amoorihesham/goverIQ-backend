# Phase 0 Research: Audit, Hardening & Deployment

**Feature**: 006-audit-hardening-deployment
**Date**: 2026-05-18

This document resolves the open technical decisions for the audit-query / export
module and the production-hardening + deployment work. Each section follows the
**Decision / Rationale / Alternatives** format. It builds directly on the
conventions established in features 001–005 and the codebase as it stands today.

> **Prerequisite (not a design decision):** `src/app.ts` and
> `src/shared/audit/emitter.ts` currently contain **committed, unresolved git
> merge-conflict markers** (`<<<<<<<`, `=======`, `>>>>>>>`). The project does
> not compile in this state. Resolving those markers — keeping the
> `meetings`/`votes` route registrations on the HEAD side and the clean
> `emitter.ts` body — is **task zero** of this feature and a precondition for
> every other task. It is not a Phase 5 design choice; it is repository hygiene
> that must land first.

---

## 1. Audit module layout & route shape

**Decision**: Add an 8th domain module, `src/modules/audit/`, mirroring the
`votes` / `minutes` layout: `audit.routes.ts` / `audit.controller.ts` /
`audit.service.ts` / `public.ts` / `schemas/zod.ts` / `types/request.ts` /
`constants/index.ts` / `utils/`. It exposes **two routes** using the
project-wide **flat** route shape (org as a trailing path segment, lifted by
`attachOrgId`):

| Method & path                            | Permission     |
| ---------------------------------------- | -------------- |
| `GET /api/v1/audit/org/:orgId`           | `audit:view`   |
| `GET /api/v1/audit/org/:orgId/export`    | `audit:export` |

**Rationale**: Every module shipped after feature 003 uses flat routes
(`/api/v1/votes/meeting/:meetingId/org/:orgId`,
`/api/v1/meetings/org/:orgId`). `attachOrgId` already lifts `:orgId` from any
position. The master `IMPLEMENTATION-PLAN.md` shows `/api/v1/orgs/:orgId/audit`,
but that nested shape was superseded across the actual implementation — the plan
follows the **codebase convention**, not the stale master doc. A dedicated
module keeps audit read/export isolated from the audit *emitter* (which stays in
`src/shared/audit/`, called by every writing module).

**Alternatives considered**:

- *Nested under the org module* (`/api/v1/orgs/:orgId/audit`) — matches the
  master plan's wording but breaks the flat-route convention every shipped
  module follows; rejected for consistency.
- *Routes inside `src/shared/audit/`* — mixes the request-facing read surface
  with the cross-cutting emitter; rejected for separation of concerns.

---

## 2. Audit query — pagination & filtering

**Decision**: The query uses the existing keyset-pagination helpers
(`encodeCursor` / `decodeCursor` / `applyKeysetWhere` in
`src/shared/pagination/`) ordered on **`(created_at DESC, id)`** — the exact
ordering the `audit_logs_org_created_idx` index supports. Default page size 20,
max 100 (platform convention). Filters — `actorId`, `event`, `entityType`,
`entityId`, `from`, `to` — are optional, combine with **AND**, and `from`/`to`
are **inclusive** bounds on `created_at`. `event` is matched as a free-form
string equality (no enum), so future event types filter without code changes.

**Rationale**: `applyKeysetWhere` already implements the
`(createdAt, id)` keyset predicate for descending order; `audit_logs` already
carries `(org_id, created_at DESC)`, `(org_id, actor_id)`, `(org_id, event)`,
and `(org_id, entity_type, entity_id)` indexes from feature 001 — every filter
column is index-backed, satisfying Constitution IV with no new index. A `from >
to` range is allowed and simply yields an empty set (spec edge case). Filtering
by `entityId` without `entityType` is permitted (the `entity_id` predicate
stands alone).

**Alternatives considered**:

- *Offset pagination* — O(n) deep-page scans and gap/duplicate risk under
  concurrent inserts; the spec demands 100k-entry gap-free paging (SC-503).
  Rejected.
- *A new composite index for every filter permutation* — the four feature-001
  indexes already cover every single-column filter; Postgres combines them via
  bitmap scans for multi-filter queries. No new index needed.

---

## 3. Read-time payload redaction

**Decision**: A single shared module — `src/shared/audit/redact.ts` — exports a
frozen deny-list constant `AUDIT_REDACTION_DENYLIST` and a pure function
`redactAuditPayload(payload)`. The deny-list contains the sensitive field names
that may appear in stored payloads: `passwordHash`, `password`, `otpHash`,
`tokenHash`, `refreshTokenHash`, `refreshTokenCleartext`, `accessToken`,
`inviteTokenHash`. `redactAuditPayload` deep-walks the JSON `{before, after}` /
`{data}` structure and drops any key whose name is on the list, returning a new
object. The **stored row is never mutated** — redaction runs only on the value
returned by the query path and the export path, and **both call the identical
function**, so for any filter set query and export return byte-identical
redacted payloads.

**Rationale**: A read-time step keeps `audit_logs` immutable (Principle 7 / 4
and FR-507) while satisfying FR-504a. Centralising the deny-list in one frozen
constant guarantees query/export parity — the spec requires it. The deny-list
mirrors the field names Pino already redacts in `src/shared/logger/index.ts`,
keeping one mental model of "what is secret".

**Alternatives considered**:

- *Redact at write time in `emitAudit`* — would lose data permanently and is
  the wrong layer; the spec explicitly wants the stored record intact.
- *Per-event redaction rules* — more precise but far more surface area and
  drift risk; a flat name-based deny-list applied uniformly is simpler and the
  spec models it as a single list.

---

## 4. Database-level append-only enforcement (FR-507)

**Decision**: Add migration `0004_audit_append_only.sql` that installs a
**`BEFORE UPDATE OR DELETE` trigger** on `audit_logs`. The trigger function
unconditionally `RAISE EXCEPTION 'audit_logs is append-only'`. As defence in
depth the same migration also `REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC`.

**Rationale**: The master plan's wording — "the application's database role has
INSERT but not UPDATE or DELETE" — is grant-based, but a plain `REVOKE` does
**not** constrain the role that *owns* the table (an owner keeps all privileges
regardless of grants), and in the MVP single-container deployment the
application connects with one role that also owns the schema. A
`BEFORE UPDATE OR DELETE` trigger is enforced by the data store itself,
**regardless of role or ownership**, satisfying FR-507's "rejected by the data
store, not merely by application code". It is pure SQL, ships in the normal
migration pipeline, and needs no second DB role or infra change. INSERT is
untouched, so the transactional emitter keeps working.

**Alternatives considered**:

- *Two DB roles* (a privileged owner/migrator role + a least-privilege runtime
  role with INSERT-only on `audit_logs`) — the textbook approach and a sound
  future hardening step, but it requires provisioning and wiring a second role
  and is outside this MVP's single-role deployment model. Recorded as future
  work; the trigger delivers the same guarantee now.
- *Application-only guard* — explicitly rejected by FR-507.

---

## 5. Export formats — CSV and PDF

**Decision**: The export endpoint accepts `?format=csv` (default) or
`?format=pdf`; any other value is rejected by the Zod schema with
`VALIDATION_ERROR` (400). CSV is generated by a **hand-rolled, dependency-free**
writer in `src/modules/audit/utils/csv.ts` (RFC 4180 quoting). PDF reuses the
**already-installed `pdfkit`** dependency via `src/modules/audit/utils/pdf.ts`,
following the pattern of `src/modules/minutes/utils/pdf.ts`.

**Rationale**: CSV is a trivial, well-specified flat format — adding a CSV
library would violate the "evaluate before adopting" technical standard for no
benefit. `pdfkit` is already a pinned dependency used by the minutes module, so
the human-readable document format costs zero new dependencies. No new error
code is needed — `VALIDATION_ERROR` already covers the unsupported-format case.

**Alternatives considered**:

- *A CSV library* (`csv-stringify`, `fast-csv`) — unnecessary dependency for a
  format that is a few lines of quoting logic; rejected.
- *XLSX export* — the spec scopes export to exactly two formats
  (spreadsheet-compatible flat + human-readable document); XLSX is out of scope.

---

## 6. Unbounded export — streaming strategy

**Decision**: Export applies **no page-size cap** and must not load an arbitrary
audit history fully into memory (spec edge case, SC-504). The service reads the
filtered set in **keyset-paginated batches** (the same `(created_at DESC, id)`
predicate as the query, batch size held in `audit/constants/index.ts`) and feeds
each batch into the formatter, which writes incrementally to the Fastify
`reply.raw` stream. CSV streams row batches directly; PDF pipes a `pdfkit`
document straight to the response. The response sets
`Content-Type` (`text/csv` / `application/pdf`) and a
`Content-Disposition: attachment; filename="audit-<orgId>-<timestamp>.<ext>"`
header — bypassing the success envelope, exactly as `minutes/export` does.

**Rationale**: Batched keyset reads keep memory bounded by one batch regardless
of total volume, while reusing the query's ordering keeps export and query
result sets provably identical (FR-506). Streaming to `reply.raw` matches the
established file-download exception to the response envelope.

**Alternatives considered**:

- *Single unbounded `SELECT` into an array* — fails the "unsafe to load into
  memory" edge case; rejected.
- *A background job that emails a link* — over-engineered for the MVP and
  changes the synchronous-download UX the spec describes; rejected.

---

## 7. Central audit-event registry (completeness verification)

**Decision**: Introduce `src/shared/audit/events.ts` exporting a frozen
`AUDIT_EVENTS` constant — the canonical set of the **29** event-type strings the
system emits — and a derived `AuditEventName` union type. `AuditEvent.event` in
`src/shared/audit/types.ts` is retyped from `string` to `AuditEventName`, so
every `emitAudit` call site is checked by the compiler against the registry. A
unit test asserts the registry holds exactly 29 entries; an integration test
exercises the full governance flow and asserts all 29 appear in `audit_logs`.

**Rationale**: FR-508 / SC-501 require *all 29* event types wired and
observable, with no operation emitting more than one. Today `event` is a
free-form `string`, so a typo or a missing event is invisible until runtime. The
29 strings already emitted across the modules and queue jobs are:
`user.registered`, `user.verified`, `user.login`, `user.logout`, `org.created`,
`org.updated`, `org.archived`, `org.onboarding_skipped`, `role.created`,
`role.updated`, `role.deleted`, `member.role_assigned`, `member.role_revoked`,
`member.removed`, `invitation.created`, `meeting.created`, `meeting.updated`,
`meeting.status_changed`, `meeting.attendee_added`, `meeting.attendee_removed`,
`vote.created`, `vote.closed`, `ballot.submitted`, `minutes.created`,
`minutes.updated`, `minutes.finalized`, `minutes.correction_added`,
`minutes.exported`, `system.cleanup`. That is exactly 29 — the spec's count is
confirmed against the codebase (it is two more than the master plan's stale
27-row table, which omits `org.onboarding_skipped` and `system.cleanup`).

**Alternatives considered**:

- *Leave `event` as a free string* — no compile-time completeness guarantee;
  rejected, since SC-501 demands 100% completeness.
- *Generate the registry from a scan of the source* — brittle build-time magic;
  an explicit hand-maintained frozen constant is clearer and reviewable.

---

## 8. Health endpoints (FR-513)

**Decision**: Keep the two existing routes in
`src/shared/http/plugin.ts` but make them spec-compliant. `GET /health/live`
returns `200 { status: 'live', timestamp }` with **no dependency probe**.
`GET /health/ready` runs the existing `checkHealth()` DB probe (`SELECT 1`) and
returns `200 { status: 'ready', timestamp }` when the database is reachable or
`503 { status: 'unavailable', timestamp }` when it is not. Both are
unauthenticated and carry an ISO-8601 timestamp. The stray `GET /protected`
debug route in the same plugin is **removed**.

**Rationale**: The endpoints already exist with the correct split (liveness
shallow, readiness probes the DB) — only the response bodies fall short:
`/health/live` returns `{ ok: 'OK' }` and `/health/ready` returns
`{ ready: boolean }`, neither with a timestamp (FR-513, SC-509 require one).
Liveness must stay shallow so a DB outage does not trigger pod restarts while
readiness correctly drains traffic — the spec's edge case spells this out. The
`/protected` route is debug scaffolding that does not belong in a production
build.

**Alternatives considered**:

- *A single `/health` endpoint* — cannot distinguish "restart me" from "stop
  routing to me"; the spec mandates two endpoints.
- *Probing Redis/SMTP in readiness* — the spec scopes the readiness probe to the
  database only; notification/queue are fire-and-forget and must not gate
  traffic. Rejected.

---

## 9. Rate limiting — delegated to the API gateway

**Decision**: Rate limiting is **not implemented in the application**. It is
delegated entirely to the cloud provider's API gateway / edge layer
(FR-510/FR-511, spec clarification 2026-05-17). The application ships **no**
rate-limit middleware, no `@fastify/rate-limit` dependency, and no counter
store. The gateway configuration — that `POST /api/v1/auth/register`,
`POST /api/v1/auth/login`, and `POST /api/v1/auth/resend-otp` are limited per
request source over a time window, with the **resend-otp limit strictest** — is
captured as deployment documentation in
[contracts/deployment.md](./contracts/deployment.md), not as code.

**Rationale**: The user has explicitly chosen to delegate rate limiting to an
external API gateway. The application is stateless and multi-instance (FR-517);
keeping rate-limit counters out of the app avoids a shared-counter store
(Redis-backed limiter) and a per-instance-inconsistency problem. `@fastify/rate-limit`
is **not** currently a dependency, so there is nothing to remove — the decision
is simply to add nothing. The concrete thresholds and window durations are
gateway config chosen at deploy time and are intentionally out of this spec.

**Alternatives considered**:

- *`@fastify/rate-limit` with a Redis store* — would work across instances but
  re-implements what the chosen gateway already provides; explicitly rejected by
  the user's delegation decision.
- *In-process per-instance limiter* — inconsistent across replicas behind a load
  balancer; wrong for a stateless multi-instance design.

---

## 10. Containerization (FR-517)

**Decision**: Add a **multi-stage `Dockerfile`** at the repo root: a `builder`
stage on `node:24` installs all deps with `pnpm` and runs `pnpm build` (`tsup`);
a slim `node:24-slim` runtime stage installs production deps only and copies
`dist/` plus `src/db/migrations/`. The container entrypoint runs
`node --import ./dist/tracing.js ./dist/main.js` — `main.ts` already runs
migrations before `listen()`, so migrations apply on container start. The
existing `.dockerignore` is reviewed and extended. `docker-compose.yml` stays a
**local-dev infrastructure** file (Postgres + Jaeger + Prometheus + Grafana) and
is **not** the production unit.

**Rationale**: A multi-stage build keeps the runtime image small and free of
build tooling. The image must include `src/db/migrations/` because
`runMigrations` reads the SQL files from that folder at startup (FR-516). The
stateless design (all session state in `refresh_tokens`, not memory) already
supports running multiple replicas behind a load balancer (FR-517) with no
further work.

**Alternatives considered**:

- *Single-stage build* — ships compilers and dev dependencies in the runtime
  image; larger attack surface, rejected.
- *Treat `docker-compose.yml` as the deployable* — it is a dev convenience
  bundling observability backends, not a production artifact; rejected.

---

## 11. Startup configuration hardening (FR-514 / FR-515 / FR-518)

**Decision**: `src/shared/config/env.ts` already parses with Zod and
`process.exit(1)` on any missing/invalid variable (FR-514 satisfied). Two gaps
are closed: (a) every **secret** variable gets a **minimum-length** Zod
constraint — `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` become
`.min(32)` (FR-515); (b) **`.env.example` is rewritten** so that every variable
the schema reads is listed with a comment stating its purpose and whether it is
required or has a default (FR-518). `.env.example` currently drifts badly from
the schema — it lists `JWT_SECRET` / `COOKIE_SECRET` (names the schema does not
read) and omits `APP_BASE_URL`, `HELMET_HSTS_MAX_AGE`, `DATABASE_POOL_MAX_SIZE`,
`OTEL_*`, `SENTRY_*`, and the JWT secret names the schema actually requires.

**Rationale**: A secret that is present but too short is the same risk as a
missing one (spec edge case, SC-510); a length floor at the schema is the
single enforcement point. `.env.example` is the FR-518 deliverable — it must be
the authoritative, accurate configuration reference, and right now it is
neither.

**Alternatives considered**:

- *Runtime length checks scattered in code* — duplicated and easy to skip; the
  Zod schema is the one place every variable is already validated.

---

## 12. API documentation completeness (FR-519)

**Decision**: `@fastify/swagger` already generates an OpenAPI document from
every route's Zod schema, and `app.ts` tags routes by URL segment. The work is:
(a) add an `Audit` tag and register the audit module's two routes with full
request/response/error Zod schemas; (b) create the missing
`src/scripts/gen-openapi.ts` that the `gen:openapi` package script already
references (the script path does not exist today); (c) audit every existing
route schema and add any missing error-response shapes and `summary`/`description`
text so the generated document is complete for **all** endpoints.

**Rationale**: FR-519 requires every endpoint documented with request shape,
success shape, every error it can produce, and required permission. The
generation pipeline exists; the gaps are the dangling `gen:openapi` script and
schema completeness. The exact endpoint total is confirmed during
implementation against the assembled route set (it is the prior modules' routes
plus the two new audit routes plus the two health routes).

**Alternatives considered**:

- *Hand-written API docs* — drifts from code, violates Principle III's
  "documentation drift blocks merge"; generated-from-schema is the standing
  approach.

---

## 13. Structured-logging audit (FR-520)

**Decision**: Pino is already the logger and emits JSON in production
(`src/shared/logger/index.ts`, `pino-pretty` only outside production) — FR-520
is largely met. The remaining work is a sweep for `console.*` calls on
production code paths: `src/main.ts`'s shutdown-timeout handler uses
`console.error` and is switched to `logger.error`. `src/shared/config/env.ts`'s
`console.error` on invalid-env is **kept** — it runs before the logger module
(which itself imports `env`) can exist, so it is a legitimate pre-logger
bootstrap path, documented as such. A lint check / review confirms no other
plain-text log statements remain.

**Rationale**: Constitution Technical Standards and FR-520 prohibit plain-text
logs in production code paths. The env-validation `console.error` is an
unavoidable bootstrap exception (the logger depends on `env`); every other path
has the structured `logger` available and must use it.

**Alternatives considered**:

- *A custom pre-logger structured emitter for env errors* — over-engineering a
  single failure path that aborts the process anyway; a documented exception is
  proportionate.

---

## Summary of decisions

| #  | Decision                                                                 |
| -- | ------------------------------------------------------------------------ |
| 1  | New `src/modules/audit/` module, 2 flat routes, no onboarding gate       |
| 2  | Keyset pagination on `(created_at DESC, id)`; AND-combined filters       |
| 3  | Read-time redaction via shared `redact.ts` + frozen deny-list            |
| 4  | DB append-only via `BEFORE UPDATE OR DELETE` trigger (migration 0004)    |
| 5  | Export = hand-rolled CSV (no dep) + `pdfkit` PDF (existing dep)          |
| 6  | Unbounded export streamed via batched keyset reads                       |
| 7  | Central `AUDIT_EVENTS` registry of 29 events; `event` retyped to union   |
| 8  | Health: timestamps on `/live` + `/ready`; remove stray `/protected`      |
| 9  | Rate limiting fully delegated to API gateway — zero app code             |
| 10 | Multi-stage production `Dockerfile`; compose stays dev-only              |
| 11 | Secret min-length in Zod; rewrite `.env.example` as the config reference |
| 12 | Add `Audit` tag + `gen-openapi.ts`; complete every route schema          |
| 13 | Switch `main.ts` shutdown logging to Pino; keep env bootstrap exception  |

No decision introduces a new runtime dependency. No new database table or column
is created. One additive, non-destructive migration (`0004`) installs the
append-only trigger.
