# GovernIQ Backend — Scaling & Maintainability Roadmap

**Version:** 1.1
**Status:** Plan (no implementation in this pass)
**Date:** 2026-05-07
**Horizon:** 12–24 months · target ~100 RPS · dozens of orgs · single deployable
**Companion to:** [docs/IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)
**Effort summary:** ~31 focused dev-days across 7 phases (calendar ~8–10 weeks for one mid-level engineer with normal interrupts and reviews)

---

## Context

The GovernIQ backend is a Fastify 5 + Drizzle + Postgres modular monolith currently completing master-plan Phase 2 (Org/Roles/Members). Phases 3–5 (Meetings, Voting, Minutes, Audit, Hardening) are still ahead. Before traffic grows past hobby scale, several operational gaps must be closed: no rate limiting, no graceful shutdown, no request IDs, no async work, no metrics, sync SMTP in the request path, broken cursor pagination, no background cleanup, no DB-level audit immutability, and several cross-module DB reaches that erode the "modular" in modular monolith.

**Goal of this plan:** raise the floor to production-grade for ~100 RPS / dozens of orgs *without* breaking the monolith. The roadmap is phased so each phase ships independently and pays off on its own. Microservice extraction, sharding, read replicas, multi-region, and CQRS are explicitly **out of scope** — Phase 7 + Layer K codify the trigger thresholds at which to revisit them.

The seven Non-Negotiable Principles in the master plan are constraints on every recommendation. Where one looks like it might be violated (e.g., permission caching), the principle wins.

---

## How to Read This Document

- The **Phase Roadmap** below is the executable plan: phase numbers map to delivery order. Each phase is "must finish before next starts" only if the next phase's design depends on it; otherwise phases can be parallelized by separate engineers.
- Each phase has a **dedicated section** with:
  - **Problem** — what specifically is broken / missing today, with file refs.
  - **Solution** — the architectural change.
  - **Implementation steps** — concrete tasks with file paths and order.
  - **Effort** — dev-days (focused work, ignoring meetings/PR review).
  - **Why this solves the problem** — the causal chain from change to outcome.
  - **Risk if skipped** — what breaks (and at what scale) if you deprioritize.
  - **Verification** — concrete checks that prove the phase is "done".
- The **Layer Summary** at the bottom is the technical decomposition (cross-cutting concerns), useful as a reference index.

---

## Phase Roadmap

| # | Phase | Effort | Calendar | Why this position |
|---|-------|--------|----------|-------------------|
| **1** | **Operational Floor** | ~5 d | Week 1 | Cheap, decouples deploys from outages. Required before any traffic growth. Without rate limiting and graceful shutdown, every other phase is built on sand. |
| **2** | **Async Work & Queues** | ~5.5 d | Week 2 | Lifts SMTP latency off the request path. Unlocks worker process model that later phases (exports, cleanup, scheduled jobs) build on. |
| **3** | **Module Discipline** | ~5.5 d | Week 3 | Cheap structural fix while modules are still few (auth + org). Cost compounds the longer it waits — every new module ossifies the cross-module leaks. |
| **4** | **Observability** | ~3.5 d | Week 4 (first half) | Required to validate every later phase. Useless before async work because the latency profile is wrong until Phase 2 ships. |
| **5** | **DB & Data Shape** | ~4 d | Week 4–5 | Index audit + slow-query log + audit-table immutability + cursor pagination rollout. Needs Phase 4 metrics to set thresholds. |
| **6** | **Caching & Storage** | ~5.5 d | Week 6 | Last because it requires Redis + S3 ops and stable observability to validate. Caching without metrics is faith-based. |
| **7** | **Security & Policy** | ~2.5 d | Week 7 | Continuously interleaved with master plan Phase 5; gated final hardening here. JWT rotation runbook codified after async/observability so rotation events can be safely traced. |

**Grand total: ~31 dev-days · ~7 calendar weeks of focused work · realistically 8–10 weeks with reviews, deploys, and integration testing.**

**What's deliberately deferred (revisit only on Layer K triggers):** read replicas, DB sharding, microservice extraction, multi-region, eventual-consistency tricks, CQRS, partitioning live cutover.

---

## Phase 1 — Operational Floor

**Effort: ~5 dev-days · Week 1**

The lowest-cost, highest-value phase. None of these violate any principle. Without them, a single misbehaving client or a single deploy can take production down.

### 1.1 Rate limiting on auth routes — 0.5 d

**Problem.** [src/modules/auth/auth.routes.ts](../src/modules/auth/auth.routes.ts) exposes `/auth/login`, `/auth/register`, `/auth/resend-otp` with no protection. A single bot can fan out a credential-stuffing attack or trigger thousands of OTP emails (which fan out as SMTP cost). Master-plan Phase 5 mandates rate limiting; we don't want to wait that long.

**Solution.** Register `@fastify/rate-limit` globally with route-specific overrides for auth endpoints. Storage starts in-memory (single instance is fine at this scale); switch to a Redis store in Phase 6 when Redis lands and we need multi-instance.

**Implementation steps.**
1. `pnpm add @fastify/rate-limit`.
2. Register in [src/app.ts](../src/app.ts) **before** any route plugin (rate-limit must be earliest in the chain to short-circuit before any handler logic).
3. Set defaults: `max: 600`, `timeWindow: '1 minute'` per IP for the global limit.
4. Per-route overrides in [src/modules/auth/auth.routes.ts](../src/modules/auth/auth.routes.ts):
   - login: `{ max: 10, timeWindow: '1 minute' }`
   - register: `{ max: 5, timeWindow: '1 minute' }`
   - resend-otp: `{ max: 3, timeWindow: '15 minutes', keyGenerator: (req) => sha256(req.body.email) }` — keyed on email so a single email cannot flood SMTP regardless of IP.
   - refresh: `{ max: 30, timeWindow: '1 minute' }`
5. Custom error response that fits our envelope shape — wrap rate-limit's response via the `errorResponseBuilder` option so it returns `{ success: false, error: { code: 'RATE_LIMITED', message, statusCode: 429 } }`.

**Why this solves the problem.** A 429 returned at the framework layer never executes service code, so the bcrypt hash on `/login` never runs, and SMTP enqueue on `/resend-otp` never happens. Attack cost on the server stays bounded.

**Risk if skipped.** Trivial credential-stuffing on `/login`. SMTP-cost amplification on `/resend-otp` (especially with paid SMTP providers — every spam OTP costs money).

### 1.2 Graceful shutdown — 0.5 d  [✅]

**Problem.** [src/main.ts](../src/main.ts) does not handle `SIGTERM` or `SIGINT`. Every deploy `kill -15`'s the process mid-request. In-flight transactions are torn down without `COMMIT`/`ROLLBACK`. The migration advisory lock at [src/shared/database/migrate.ts](../src/shared/database/migrate.ts) (`pg_advisory_lock(5432001)`) can outlive the process inconsistently across pg versions.

**Solution.** Trap `SIGTERM` and `SIGINT`. Stop accepting new connections, wait up to 30s for in-flight handlers to drain, then close the pg pool and exit.

**Implementation steps.**
1. In [src/shared/database/client.ts](../src/shared/database/client.ts), export the `pool` instance alongside `db` (currently only `db` is exported).
2. In [src/main.ts](../src/main.ts), after `app.listen(...)`, register:
   ```ts
   const shutdown = async (signal: string) => {
     logger.info({ signal }, 'shutdown signal received');
     try {
       await app.close();        // stops accepting new connections; waits for in-flight
       await pool.end();         // drains the pg pool
       process.exit(0);
     } catch (err) {
       logger.error({ err }, 'shutdown failed');
       process.exit(1);
     }
   };
   process.on('SIGTERM', () => shutdown('SIGTERM'));
   process.on('SIGINT', () => shutdown('SIGINT'));
   ```
3. Set Fastify's `closeGraceTimeout` to 30000ms so `app.close()` won't hang forever.

**Why this solves the problem.** `app.close()` blocks new connections at the listener; existing handlers complete naturally; `pool.end()` drains in-flight queries and releases the advisory lock. Rolling deploys (Kubernetes, ECS) become safe.

**Risk if skipped.** Orphan transactions on every deploy. Long-tail bugs where a deploy interrupts a `withTx` block in [src/shared/database/transaction.ts](../src/shared/database/transaction.ts) and leaves audit-log gaps.

### 1.3 Request IDs / correlation IDs — 1 d  [✅]

**Problem.** Today there's no way to correlate a user-reported failure to its audit row, the log line that printed an error, and the SMTP delivery attempt. Pino logs have an autogen `reqId` but it never reaches [emitAudit](../src/shared/audit/emitter.ts) or the notification service.

**Solution.** Configure Fastify's `genReqId` to prefer an inbound `x-request-id` header (so the frontend's existing trace propagates) and fall back to ULID. Plumb the request ID into the audit payload and the notification dispatcher's job ID metadata.

**Implementation steps.**
1. In [src/app.ts](../src/app.ts) Fastify constructor opts:
   ```ts
   genReqId: (req) => req.headers['x-request-id']?.toString() ?? ulid(),
   requestIdLogLabel: 'reqId',
   requestIdHeader: 'x-request-id',
   ```
2. New file `src/shared/http/context.ts`:
   ```ts
   export interface RequestContext { reqId: string; userId?: string; orgId?: string; }
   export function contextFromRequest(req: FastifyRequest): RequestContext { ... }
   ```
3. Modify [src/shared/audit/emitter.ts](../src/shared/audit/emitter.ts) to accept an optional `reqId` field and store it in the `payload.requestId` slot. Backward-compatible default.
4. Update controllers to pass `contextFromRequest(req)` into services instead of individual `userId`/`orgId` args.

**Why this solves the problem.** A debugging session for "user X says register failed at 3:47pm" becomes: grep logs for `reqId`, find the trace, find the audit row, find the SMTP job. End-to-end provenance.

**Risk if skipped.** Each later phase (observability, error reporting, audit-list endpoint) costs more because they all need this primitive.

### 1.4 Structured logging upgrade — 0.25 d  [✅]

**Problem.** [src/shared/logger/index.ts](../src/shared/logger/index.ts) hard-wires `pino-pretty` regardless of environment, which is colorized stdout — slow and unparseable in production log aggregators. [src/shared/http/health.ts](../src/shared/http/health.ts) creates a *second* Pino instance, fragmenting log shape. Nothing redacts secrets — a stack trace through the password hashing path can leak a token.

**Solution.** One shared logger; redaction list; JSON-only in production.

**Implementation steps.**
1. In [src/shared/logger/index.ts](../src/shared/logger/index.ts), guard `transport: { target: 'pino-pretty', ... }` behind `NODE_ENV !== 'production'`.
2. Add `redact: { paths: ['password', 'passwordHash', 'otpHash', 'tokenHash', 'refreshTokenCleartext', 'accessToken', '*.Authorization', 'cookie', 'set-cookie', 'req.headers.authorization', 'req.headers.cookie'], remove: false, censor: '[REDACTED]' }`.
3. Delete the duplicate Pino instance in [src/shared/http/health.ts](../src/shared/http/health.ts); import the shared logger.
4. Each module's `public.ts` (Phase 3) will export `logger.child({ module: '<name>' })` for domain-tagged logs.

**Why this solves the problem.** One JSON shape across HTTP, services, audit, and worker (Phase 2) — log aggregator queries become reliable. Redaction prevents the worst-case leak.

**Risk if skipped.** Token leakage in production. Log ingest cost on colorized output. Ongoing fragmentation as more modules ship.

### 1.5 Health check expansion (Kubernetes-style) — 0.5 d   [✅]

**Problem.** [src/shared/http/health.ts](../src/shared/http/health.ts) has a single `/health` endpoint that does `SELECT 1`. If Postgres has a 2-second hiccup, every health check fails, every K8s pod restarts, and we spiral into a restart storm.

**Solution.** Split liveness from readiness, the K8s-standard pattern.

**Implementation steps.**
1. Refactor [src/shared/http/health.ts](../src/shared/http/health.ts):
   - `GET /health/live` — returns 200 unconditionally. No DB call, no Redis call, no anything except "process is up".
   - `GET /health/ready` — current logic (DB `SELECT 1`); will gain Redis `PING` in Phase 6 and queue health in Phase 2.
   - `GET /health` — alias of `/health/ready` for one release for backward compat, then remove.
2. Update [src/shared/http/plugin.ts](../src/shared/http/plugin.ts) to register both routes.
3. Update deployment manifests (K8s/ECS) to use `/health/live` for `livenessProbe` and `/health/ready` for `readinessProbe`. (Document; not in this code change.)

**Why this solves the problem.** Liveness asks "should this pod be killed and restarted?" — DB blip is **not** a yes. Readiness asks "should this pod receive traffic?" — DB blip **is** a yes (don't send users to a pod that can't serve). The two answers must come from different endpoints.

**Risk if skipped.** Restart storms during DB hiccups; traffic served before migrations complete on cold start.

### 1.6 Security headers + cookie flag audit — 0.5 d  [✅]

**Problem.** No `helmet` is registered. No HSTS. No `frame-ancestors`. The refresh cookie flags are scattered across [src/modules/auth/auth.controller.ts](../src/modules/auth/auth.controller.ts) and [src/modules/org/member.controller.ts](../src/modules/org/member.controller.ts) (invite-accept also issues a session) — nothing enforces consistency.

**Solution.** Register `@fastify/helmet`. Centralize cookie issuing.

**Implementation steps.**
1. `pnpm add @fastify/helmet`.
2. Register in [src/app.ts](../src/app.ts) with: HSTS in prod (`maxAge: 63072000, includeSubDomains: true, preload: true`), `frameguard: { action: 'deny' }`, `noSniff: true`, `referrerPolicy: { policy: 'no-referrer' }`.
3. New helper `src/shared/auth/cookies.ts` exporting `setRefreshCookie(reply, token)` and `clearRefreshCookie(reply)`. Both centralize: `httpOnly: true`, `secure: NODE_ENV === 'production'`, `sameSite: 'strict'`, `path: '/api/v1/auth'`. **Do not** set `domain`.
4. Replace direct `reply.setCookie(...)` calls in both controllers.

**Why this solves the problem.** Headers prevent XSS-driven cookie exfiltration and clickjacking on the future hosted UI. Centralized cookie issuing prevents the inevitable drift where one controller forgets `sameSite` after a refactor.

**Risk if skipped.** XSS exfil of refresh token. Clickjacking. Inconsistent cookie behavior between login and invite-accept flows.

### 1.7 Body size limits — 0.25 d   [✅]

**Problem.** Fastify's default `bodyLimit` is 1 MiB. Acceptable globally, but a future minutes-edit endpoint (Phase 4 of master plan) could legitimately need more, and an attacker can submit a 1 MiB JSON body to register or login and force-cycle the JSON parser.

**Solution.** Tighten the global limit to 64 KiB; override per-route as needed later.

**Implementation steps.**
1. In [src/app.ts](../src/app.ts) Fastify constructor: `bodyLimit: 64 * 1024`.
2. Document in `docs/MODULE-TEMPLATE.md` (Phase 3) that any route needing >64 KiB bodies must override explicitly.

**Why this solves the problem.** Memory pressure DoS via oversized JSON bodies is bounded.

**Risk if skipped.** Trivial DoS vector.

### 1.8 CI test job + frozen lockfile — 1 d  [✅]

**Problem.** Tests exist in [tests/integration/](../tests/integration/) but [.github/workflows/CI.yml](../.github/workflows/CI.yml) doesn't run them. CI today: typecheck, lint, format, build. No test execution. Also: `pnpm install` (not `--frozen-lockfile`), so transitive deps can drift silently in CI.

**Solution.** Wire vitest into CI; freeze the lockfile.

**Implementation steps.**
1. Update [.github/workflows/CI.yml](../.github/workflows/CI.yml):
   - Add a `test` job with a `services.postgres` block (image `postgres:latest`, env mirroring [docker-compose.yml](../docker-compose.yml)).
   - Steps: `pnpm install --frozen-lockfile` → `pnpm db:migrate` (against the disposable DB, doubles as migration dry-run) → `pnpm test` → `pnpm test:coverage`.
   - Coverage gate: 70% lines / 70% branches initially. Raise quarterly.
2. Replace every `pnpm install` in existing jobs with `pnpm install --frozen-lockfile`.

**Why this solves the problem.** Tests stop rotting. Migration sanity is verified on every PR. Lockfile drift is impossible.

**Risk if skipped.** Tests rot within a quarter. Production migrations break on a schema-without-migration.

### 1.9 Drizzle drift check — 0.5 d    [✅]

**Problem.** A developer can update a schema file in [src/db/schema/](../src/db/schema/) without running `pnpm db:generate`. The code thinks the column exists; production migration never created it; first request hits the broken column and 500s.

**Solution.** CI step that fails if generated migrations diverge from schema.

**Implementation steps.**
1. New step in CI's `test` job: `pnpm db:generate && git diff --exit-code src/db/migrations`.

**Why this solves the problem.** Drift is detected at PR review, not at production deploy.

**Risk if skipped.** Schema-vs-migration drift is the single most common Drizzle production bug.

### Phase 1 Verification   [ STILL_NOT_VERIFIED ]

- `curl -i POST /auth/login` 11× in 1 minute returns at least one `429`.
- `kill -15 <pid>` shows graceful drain logs and `pool.end()` before exit.
- Every log line in production includes `reqId`; password/OTP fields appear as `[REDACTED]`.
- `/health/live` returns 200 even when `docker-compose stop postgres`; `/health/ready` returns 503.
- Production response includes `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- A schema change without a migration fails CI.
- A test failure fails CI.

---

## Phase 2 — Async Work & Queues

**Effort: ~5.5 dev-days · Week 2**

Lifts SMTP latency off the request path. Establishes the worker-process model that all later async work (exports, scheduled cleanup, partition maintenance) will reuse.

### 2.1 Notification dispatcher abstraction — 1.5 d   [✅]

**Problem.** [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) calls `notificationService.send(...).catch(...)` — non-blocking, but failures are silently logged with no retry. [src/shared/notifications/service.ts](../src/shared/notifications/service.ts) creates the SMTP transport at module load (top-level singleton) — a slow SMTP TCP connect at boot blocks the first request. [src/modules/org/member.service.ts](../src/modules/org/member.service.ts) has a literal `// TODO: Send email notification with token link` because the developer wasn't sure whether to follow the same pattern.

**Solution.** Introduce a `NotificationDispatcher` interface with two implementations: in-process (dev) and BullMQ (prod). Service code calls `dispatcher.enqueue(template, to, data)` and never awaits SMTP.

**Implementation steps.**
1. New file `src/shared/notifications/dispatcher.ts`:
   ```ts
   export interface NotificationDispatcher {
     enqueue(template: 'email-verification' | 'invitation', to: string, data: object, opts?: { reqId?: string }): Promise<void>;
   }
   export class InProcessDispatcher implements NotificationDispatcher { ... }   // setImmediate + send
   export class BullMQDispatcher implements NotificationDispatcher { ... }      // 2.2
   export function createDispatcher(): NotificationDispatcher { ... }            // env-based selector
   ```
2. Modify [src/shared/notifications/service.ts](../src/shared/notifications/service.ts):
   - Lazy-init the SMTP transport (move `nodemailer.createTransport(...)` inside the first `send` call, memoized).
   - Rename `notificationService.send` to be the **worker-side** consumer; service code never calls it directly.
3. Replace call sites:
   - [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) `register` → `dispatcher.enqueue('email-verification', email, { otpCleartext, ... })`.
   - [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) `resendOtp` → same.
   - [src/modules/org/member.service.ts](../src/modules/org/member.service.ts) `inviteMember` (the TODO) → `dispatcher.enqueue('invitation', email, { tokenCleartext, ... })`.
4. Wire dispatcher into Fastify via a plugin in [src/app.ts](../src/app.ts) so handlers receive it via `request.server.dispatcher`.

**Why this solves the problem.** SMTP latency disappears from the user-perceived response time. SMTP outage means delayed email, not failed registration. The notification *contract* (template + data) is the API; the delivery mechanism is opaque to callers — exactly as the master plan specifies.

**Risk if skipped.** Slow SMTP = slow login/register. Lost OTPs on transient SMTP failure. The TODO in `member.service.ts` becomes load-bearing as Phase 2 of master plan ships.

### 2.2 BullMQ adoption (Redis-backed) — 2 d [✅]

**Problem.** In-process queue cannot survive process restarts; cannot horizontally scale HTTP because each instance has its own queue. We need a persistent, distributed queue.

**Solution.** BullMQ on Redis. Selected when `REDIS_URL` is configured.

**Implementation steps.**
1. `pnpm add bullmq ioredis`.
2. New file `src/shared/queue/bullmq.ts`:
   - Export `createQueue(name)` returning a configured `Queue` instance.
   - Export `createWorker(name, handler)` for the worker side.
   - Default job options: `attempts: 5`, `backoff: { type: 'exponential', delay: 30000, maxDelay: 3600000 }`, `removeOnComplete: { age: 3600 }`, `removeOnFail: { age: 86400 }`.
3. Failed jobs (after retries) move to a `notifications-dlq` queue. A daily reconciler in `worker.ts` (2.3) reads the DLQ depth and emits `bullmq_dlq_depth{queue}` (Phase 4 metrics).
4. Idempotency: dispatcher computes `jobId = sha256(template + ':' + userId + ':' + verificationOrInvitationId)` so re-enqueueing the same OTP refresh deduplicates.
5. Add to [src/shared/config/env.ts](../src/shared/config/env.ts):
   - `REDIS_URL` (optional in dev, required in prod when `QUEUE_BACKEND=redis`).
   - `QUEUE_BACKEND: 'memory' | 'redis'` (default by `NODE_ENV`).

**Why this solves the problem.** Jobs survive restarts; multiple HTTP instances share one queue; retries with exponential backoff handle transient SMTP outages without losing OTPs; idempotency prevents duplicate sends on re-enqueue.

**Risk if skipped.** Cannot horizontally scale HTTP. Single deploy = lost queued OTPs.

### 2.3 Worker process — separate entrypoint — 1 d [✅]

**Problem.** All cleanup, queue consumption, and future export jobs need to run somewhere. Running them inside the HTTP process means scaling HTTP also scales workers (or vice versa) — coupling we don't want.

**Solution.** Second entrypoint `src/worker.ts`. Same codebase (so the modular monolith stays singular), different `main()`. Workers and HTTP scale independently.

**Implementation steps.**
1. New file `src/worker.ts`:
   - Initialize logger, db pool, dispatcher.
   - Register the `notifications` queue worker (calls the worker-side `notificationService.send` from 2.1).
   - Register the cleanup workers (2.4).
   - Same graceful shutdown as 1.2 (SIGTERM/SIGINT → drain workers → `pool.end()`).
   - **No HTTP listener.**
2. Modify [tsup.config.ts](../tsup.config.ts) `entry` to include `src/worker.ts`.
3. Add to [package.json](../package.json) scripts:
   - `"worker": "node dist/worker.js"`.
   - `"dev:worker": "tsx watch src/worker.ts"`.
4. Update [docker-compose.yml](../docker-compose.yml) to include a `worker` service alongside the existing `app` service (both running the same image, different command).
5. In dev mode (`QUEUE_BACKEND=memory`), the `InProcessDispatcher` runs the worker handler inline — no separate process needed locally.

**Why this solves the problem.** Workers and HTTP can be scaled, deployed, and observed independently while sharing one codebase, one schema, one auth model. This is the central trick that lets the monolith stay a monolith *and* scale.

**Risk if skipped.** No path to scale background work. No path to add cleanup jobs without coupling them to HTTP traffic.

### 2.4 Background cleanup jobs — 1 d  [✅]

**Problem.** [src/db/schema/auth.ts](../src/db/schema/auth.ts) defines `email_verifications`, `refresh_tokens`. [src/db/schema/org.ts](../src/db/schema/org.ts) defines `invitations`. None of these are ever cleaned up. Every failed register adds an `email_verifications` row. Every refresh adds a `refresh_tokens` row (the old one is deleted on rotation, but used-and-expired ones accumulate). Every expired-but-not-cleaned-up invitation pollutes the partial-unique index lookup.

**Solution.** Three repeating BullMQ jobs scheduled in `worker.ts`.

**Implementation steps.**

Define three workers in `src/shared/queue/jobs/`:

| File | Cadence | What it does |
|------|---------|--------------|
| `cleanup-otps.ts` | every 10 min | `DELETE FROM email_verifications WHERE expires_at < NOW() - INTERVAL '1 day'` |
| `expire-invites.ts` | every 1 hour | `UPDATE invitations SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < NOW()` |
| `cleanup-refresh.ts` | nightly 03:00 UTC | `DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days'` |

Each runs inside `withTx` (using [src/shared/database/transaction.ts](../src/shared/database/transaction.ts)) and emits a single `system.cleanup` audit row with row counts. The schema in [src/db/schema/audit.ts](../src/db/schema/audit.ts) already allows `orgId` and `actorId` to be `NULL`, so system-level audit rows fit.

Schedule via BullMQ's `repeat` option in `worker.ts` startup.

**Why this solves the problem.** Tables stay bounded. Query plans stay sharp (a `partial unique` index over millions of `EXPIRED` rows is wasteful). Audit trail captures the cleanup itself (compliance: who deleted what, when).

**Risk if skipped.** Tables grow unbounded. The partial-pending-invitation unique index in [src/db/schema/org.ts](../src/db/schema/org.ts) gets slower over time. Operational debt that compounds.

### Phase 2 Verification

- `POST /auth/register` returns ≤ 50ms even with `docker-compose stop mailpit`.
- Bringing SMTP back up: pending notification job is delivered within retry window.
- After 10 min of `worker.ts` running, expired `email_verifications` rows are gone.
- A `system.cleanup` audit row appears with `payload.deletedCount`.
- Both HTTP and worker processes shut down cleanly on SIGTERM (Phase 1.2 verification extends here).

---

## Phase 3 — Module Discipline

**Effort: ~5.5 dev-days · Week 3**

The codebase is small enough today that this is a one-week investment with compounding return. Every new module after this benefits.

### 3.1 Module API surface — `public.ts` per module — 1 d

**Problem.** Cross-module imports today reach into specific files inside another module's tree. Example from [src/modules/org/member.service.ts](../src/modules/org/member.service.ts):

```ts
import { hashPassword } from '@/modules/auth/utils/password';
import { generateRefreshTokenCleartext, hashRefreshToken } from '@/modules/auth/utils/tokens';
import { signAccessToken } from '@/shared/auth/jwt';
import { users, refreshTokens } from '@/db/schema/auth';
```

This means *any* refactor inside the auth module — renaming a util, restructuring a folder — is potentially a repo-wide change.

**Solution.** Each module exports a single `public.ts` representing its API surface. Anything not re-exported from `public.ts` is private to that module. ESLint enforces it (3.2).

**Implementation steps.**
1. New file `src/modules/auth/public.ts`:
   ```ts
   export { authPlugin } from './auth.routes';
   export type { AuthService } from './auth.service';
   export { createUserFromInvitation } from './auth.service';   // see 3.3
   ```
2. New file `src/modules/org/public.ts`:
   ```ts
   export { orgPlugin, invitationsPublicPlugin } from './org.routes';
   export type { OrgService, MemberService } from './services';
   ```
3. Update [src/app.ts](../src/app.ts) imports to use `public.ts` paths.
4. Existing `index.ts` files become re-exports of `public.ts` for backward compat for one release, then remove.

**Why this solves the problem.** Refactors inside a module become local. The module's external contract is one file you can read in 30 seconds.

**Risk if skipped.** As Phases 3, 4, 5 of the master plan ship more modules (meeting, vote, minutes, audit), the cross-module sprawl makes refactoring expensive.

### 3.2 ESLint enforcement of module boundaries — 0.5 d

**Problem.** A `public.ts` convention on its own gets violated within a quarter. We need mechanical enforcement.

**Solution.** `no-restricted-imports` ESLint rule.

**Implementation steps.**
1. In [eslint.config.js](../eslint.config.js), add:
   ```js
   {
     files: ['src/modules/**/*.ts'],
     rules: {
       'no-restricted-imports': ['error', {
         patterns: [{
           group: ['@/modules/*/!(public)', '@/modules/*/!(public).*'],
           message: 'Import from another module only via its public.ts surface.',
         }],
       }],
     },
   }
   ```
2. `@/shared/**` and `@/db/schema/**` remain freely importable (Drizzle ORM cross-cuts; alternative is per-module schema folders, which we defer).

**Why this solves the problem.** PR review enforces it without conscious effort. Violations fail CI.

**Risk if skipped.** Boundaries in docs only.

### 3.3 Fix existing cross-module leaks — 1.5 d

**Problem.** Verified violations in the current codebase:

- [src/modules/org/member.service.ts](../src/modules/org/member.service.ts) imports `users, refreshTokens` from `@/db/schema/auth` and writes to them inside `acceptInvitation`. The auth module owns those tables.
- Same file imports `hashPassword`, `generateRefreshTokenCleartext`, `hashRefreshToken`, `signAccessToken` — reaching into auth's `utils/` folder.

The reason it was written this way: `acceptInvitation` for a brand-new user (no existing account) needs to create a user record + issue a session — work the auth module already does for `register` + `verify-email`. Rather than duplicate it, the org module reached in.

**Solution.** Auth module exposes a transactional helper that does this atomically.

**Implementation steps.**
1. In [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts), add:
   ```ts
   export async function createUserFromInvitation(
     tx: TransactionType,
     args: { email: string; passwordCleartext: string; reqId: string },
   ): Promise<{ userId: string; accessToken: string; refreshTokenCleartext: string }> {
     // hash password, insert user, generate refresh token, sign access token, emit user.registered audit
     // all inside the caller's tx — preserves the audit-emit-in-tx invariant
   }
   ```
2. Re-export from [src/modules/auth/public.ts](../src/modules/auth/public.ts).
3. In [src/modules/org/member.service.ts](../src/modules/org/member.service.ts) `acceptInvitation`, replace the four direct imports with one:
   ```ts
   import { createUserFromInvitation } from '@/modules/auth/public';
   ```
   And call it inside the existing `withTx`.

**Why this solves the problem.** The org module no longer knows about password hashing or refresh-token mechanics. The auth module owns its tables. Audit emit stays inside the originating transaction (master-plan principle 1 holds).

**Risk if skipped.** The leak is a constant trip hazard — anyone refactoring auth must remember the org module reads its internals. Worse, when the next module needs similar functionality (e.g., a future SSO flow), it copy-pastes the leak.

### 3.4 Module template doc — 0.5 d

**Problem.** Master plan Phases 3, 4, 5 will add four more modules (meeting, vote, minutes, audit). Without a template, each new module reinvents structure.

**Solution.** Document the canonical structure.

**Implementation steps.** New file `docs/MODULE-TEMPLATE.md` describing required files per module:
- `<name>.routes.ts` — route registration only.
- `<name>.controller.ts` — request/response shape, no business logic.
- `<name>.service.ts` — domain logic; takes `tx` from `withTx`.
- `<name>.repository.ts` — DB queries only.
- `schemas/zod.ts` — Zod request/response schemas.
- `types/` — internal types.
- `public.ts` — module API surface.
- Optional: `prehandlers/`, `utils/` — internal helpers.

Plus an example skeleton for the next module.

**Why this solves the problem.** Friction to add a new module drops; consistency across modules stays.

### 3.5 Shared keyset cursor utility — 1 d

**Problem.** [src/modules/org/member.repository.ts](../src/modules/org/member.repository.ts) accepts a `cursor` parameter and ignores it. The function returns all members of an org regardless of cursor. As soon as orgs grow past ~1k members, this is a full-table scan into memory.

The master plan defines cursor pagination as the standard. Future audit-list, meetings-list, votes-list endpoints will all need it.

**Solution.** Centralize cursor encoding/decoding/application as a single shared util. Apply to the existing member list (3.6).

**Implementation steps.**
1. New file `src/shared/pagination/cursor.ts`:
   ```ts
   export function encodeCursor<T extends Record<string, unknown>>(keys: T): string {
     return Buffer.from(JSON.stringify(keys)).toString('base64url');
   }
   export function decodeCursor<T>(s: string, schema: ZodSchema<T>): T {
     try {
       const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
       return schema.parse(obj);
     } catch { throw AppError.validationError('cursor', 'invalid cursor'); }
   }
   export function applyKeysetWhere<S, I>(
     sortCol: SQLColumn<S>, idCol: SQLColumn<I>,
     cursor: { sort: S; id: I } | undefined,
     direction: 'asc' | 'desc',
   ): SQL | undefined { /* (sortCol, idCol) > / < (cursor.sort, cursor.id) */ }
   ```
2. New file `src/shared/pagination/README.md` documenting the contract:
   - All list endpoints accept `?cursor=<opaque>&limit=<1..100>` (default 20, max 100).
   - Sort columns per resource: members `(joinedAt DESC, id)` · audit `(createdAt DESC, id)` · meetings `(scheduledAt ASC, id)` · votes `(createdAt DESC, id)`.
   - Cursors are opaque — never document inner shape; never let clients construct them.

**Why this solves the problem.** Constant-time pagination at any depth (no offset). One shared implementation prevents drift across modules.

**Risk if skipped.** Each module rolls its own; behavior diverges; some accidentally use offset (which scans).

### 3.6 Apply cursor pagination to member list — 0.5 d

**Implementation steps.** In [src/modules/org/member.repository.ts](../src/modules/org/member.repository.ts) `listMembers`:
- Decode the incoming `cursor` via `decodeCursor` with a zod schema `{ joinedAt: ISO8601, id: UUID }`.
- Apply `applyKeysetWhere` against `(memberships.joinedAt, memberships.id)` with direction `desc`.
- Order by `(memberships.joinedAt DESC, memberships.id DESC)`.
- Take `limit + 1` rows; if `limit + 1` returned, encode the last row's keys as `nextCursor` and drop the extra.

**Risk if skipped.** Member list is broken-but-silent — looks fine on small data, OOMs on large.

### 3.7 In-process event bus — 1 d (optional, bring up only when first cross-module signal needs it)

**Problem.** Future modules will want fire-and-forget cross-module signals (e.g., "user joined org → send welcome email", "minutes finalized → notify attendees"). Today these would be hard imports.

**Solution.** Thin EventEmitter wrapper, with the strict constraint that it is never used for state changes that require transactional consistency.

**Implementation steps.**
1. New file `src/shared/events/bus.ts`:
   ```ts
   export type DomainEvent = | { type: 'member.joined'; orgId: string; userId: string }
                             | { type: 'org.archived'; orgId: string }
                             | ...;
   export const eventBus = new EventEmitter();
   ```
2. Modules subscribe in their plugin init.
3. Strict rule (in `src/shared/events/README.md`): **never** subscribe a handler that needs to be transactionally consistent with the originating write. That stays in the originating service inside `withTx`. Audit emission is the canonical example — it stays in `emitAudit`.

**Why this solves the problem.** Allows future loose coupling without violating principle 1 (transactional audit).

**Risk if skipped (now).** None — only a problem when the first cross-module signal arrives. Document the pattern; build when needed.

### Phase 3 Verification

- `pnpm lint` rejects an attempt to import from `@/modules/auth/utils/...` outside the auth module.
- [src/modules/org/member.service.ts](../src/modules/org/member.service.ts) no longer imports from `@/db/schema/auth`, `@/modules/auth/utils/...`, or `@/shared/auth/jwt`.
- Member list of 10k rows paginates in constant time at page 500.
- Modifying a cursor's base64 returns 400 with `validationError`.

---

## Phase 4 — Observability

**Effort: ~3.5 dev-days · Week 4 (first half)**

Required to validate every later phase. Without metrics, decisions about caching (Phase 6) and partition triggers (Phase 5) are guesses.

### 4.1 OpenTelemetry traces — 1.5 d

**Problem.** Today, when a request is slow, you have no way to know whether time was spent in the guard query, the service, the transaction, the audit emit, or the SMTP enqueue. Pino's per-line timestamps are not enough for a multi-step flow.

**Solution.** OpenTelemetry SDK with auto-instrumentation for Fastify and pg. Spans give end-to-end tracing.

**Implementation steps.**
1. `pnpm add @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http`.
2. New file `src/tracing.ts` initializing the SDK with OTLP HTTP exporter pointing at `OTEL_EXPORTER_OTLP_ENDPOINT`.
3. **Critical:** must be loaded *before* any other import. Load via `node --require ./dist/tracing.js dist/main.js`.
4. Update [package.json](../package.json) `start` script accordingly.
5. Add `OTEL_EXPORTER_OTLP_ENDPOINT` to [src/shared/config/env.ts](../src/shared/config/env.ts) (optional; if unset, traces are no-op).

**Why this solves the problem.** A trace for register → verify shows: HTTP handler (50ms) → guard query (5ms) → service logic (10ms) → DB transaction (20ms total, with 2 SQL spans inside) → notification enqueue (1ms) → response. You can finally answer "where did the time go?".

**Risk if skipped.** Slow-request triage by guesswork. Phase 6 caching decisions made on faith.

### 4.2 Prometheus `/metrics` endpoint — 1.5 d

**Problem.** Connection pool saturation, queue depth, audit insert rate, request latency distribution — all invisible today.

**Solution.** Standard Prometheus exposition over `/metrics`, gated behind a token.

**Implementation steps.**
1. `pnpm add prom-client`.
2. New plugin `src/shared/http/metrics.plugin.ts`:
   - Registers `GET /metrics`.
   - Gates access on `Authorization: Bearer ${METRICS_TOKEN}` (env var, required in prod).
   - Returns Prometheus exposition.
3. Custom metrics:
   - `http_request_duration_seconds` histogram, labels `route, method, status_class`.
   - `db_pool_total`, `db_pool_idle`, `db_pool_waiting` gauges (sourced from the exported `pool` from Phase 1.2).
   - `bullmq_queue_depth{queue}`, `bullmq_queue_failed_total{queue}`, `bullmq_queue_completed_total{queue}` (from BullMQ events in Phase 2).
   - `audit_emit_total{event}` counter (incremented inside [emitAudit](../src/shared/audit/emitter.ts)).
4. Add `METRICS_TOKEN` to [src/shared/config/env.ts](../src/shared/config/env.ts) with a 32-char min length validator.

**Why this solves the problem.** Capacity planning becomes data-driven. The Phase 5 partition-trigger decision in 5.4 needs `audit_emit_total` to know when 1k events/sec is sustained.

**Risk if skipped.** Cannot evaluate Layer K triggers. Cannot validate Phase 6 cache hit rates. Capacity surprises.

### 4.3 Error reporting integration point — 0.5 d

**Problem.** [src/shared/errors/envelope.ts](../src/shared/errors/envelope.ts) sends non-`AppError` errors to `fastify.log.error` and nothing else. In production, an unexpected error vanishes into log aggregator volume.

**Solution.** Add a `reportError` hook that forwards unexpected errors to Sentry-equivalent.

**Implementation steps.**
1. New file `src/shared/errors/reporter.ts` exporting `reportError(err, context)`. Default impl: no-op. Production: calls Sentry SDK if `SENTRY_DSN` is configured.
2. In [src/shared/errors/envelope.ts](../src/shared/errors/envelope.ts) global error handler, call `reportError(err, { reqId, userId, orgId })` for any non-`AppError`.

**Why this solves the problem.** Production regressions surface within minutes, with full stack traces and request context, instead of being inferred from user complaints.

**Risk if skipped.** Production bugs go silent until a user reports them.

### Phase 4 Verification

- A trace appears in the OTLP collector for register → verify showing SMTP enqueue and DB transaction as sibling spans.
- `curl /metrics` with token returns Prometheus exposition; without token returns 401.
- `audit_emit_total{event="user.registered"}` increments by 1 after a successful register.
- Triggering an unexpected error appears in Sentry within seconds.

---

## Phase 5 — DB & Data Shape

**Effort: ~4 dev-days · Week 4–5**

Index audit, slow-query log, audit-table immutability at the DB layer, and rolling out cursor pagination across the (currently broken) member list. Needs Phase 4 metrics to interpret.

### 5.1 `pg_stat_statements` + slow query logging — 0.5 d

**Problem.** No query-level visibility today. A future N+1 from a Drizzle relational eager-load (e.g. `with: { user: true, role: true }` in [src/modules/org/member.repository.ts](../src/modules/org/member.repository.ts)) goes unnoticed until it's slow enough to be reported by users.

**Solution.** Enable the extension; add a query-time event hook.

**Implementation steps.**
1. New migration: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements`.
2. Production postgresql.conf advisory: `log_min_duration_statement = 200ms`. (Document in `docs/DEPLOY.md` or equivalent.)
3. In [src/shared/database/client.ts](../src/shared/database/client.ts), add a pg-client query event listener that emits a Pino warn for queries >200ms with the SQL text and duration.

**Why this solves the problem.** Slow queries become visible the moment they appear, not when they cause an outage.

### 5.2 Index audit per master plan — 1 d

**Problem.** Master plan Phase 0 enumerates the indexes the system needs. Some are present in [src/db/schema/](../src/db/schema/); some may not be. There is no formal audit.

**Solution.** Verify each index is in the schema, in a migration, and in the live DB.

**Implementation steps.**
1. Audit checklist (verify each):
   - Audit logs: 4 indexes — already in [src/db/schema/audit.ts](../src/db/schema/audit.ts).
   - Auth: `users(email)` unique. **Verify** in [src/db/schema/auth.ts](../src/db/schema/auth.ts).
   - Org: `organizations(name)` case-insensitive unique, `organizations(slug)` unique, partial unique on `invitations(orgId, email) WHERE status = 'PENDING'`, `memberships(userId, orgId)` unique. **Verify** in [src/db/schema/org.ts](../src/db/schema/org.ts).
   - Hot path indexes for keyset pagination: `audit_logs(orgId, createdAt DESC, id)` (already partly covered), `memberships(orgId, joinedAt DESC, id)`.
2. For each missing index: add to schema, generate migration, ensure migration uses `CREATE INDEX CONCURRENTLY` (manual edit; Drizzle generates non-concurrent by default).
3. `pnpm db:migrate` and verify with `\d <table>` in psql.

**Why this solves the problem.** Sequential scans become index scans; query plans stay sharp as data grows.

**Risk if skipped.** A missing partial-pending invitation index means `findPendingInviteByOrgEmail` in [src/modules/org/member.repository.ts](../src/modules/org/member.repository.ts) seq-scans the invitations table.

### 5.3 Audit-log INSERT-only at the database — 1 d

**Problem.** Master-plan principle 1 says audit is INSERT-only. Today this is enforced *only* by code convention via [emitAudit](../src/shared/audit/emitter.ts). A bug in a future module — or a developer running ad-hoc SQL — could `UPDATE audit_logs`. Defense in depth requires the DB itself to refuse.

**Solution.** Two layers: GRANT/REVOKE and a row-level trigger.

**Implementation steps.**
1. Define a separate **migration role** with DDL privileges. The application's runtime role must NOT have UPDATE/DELETE on audit_logs.
2. New migration:
   ```sql
   REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM <app_role>;
   GRANT SELECT, INSERT ON audit_logs TO <app_role>;

   CREATE FUNCTION raise_audit_immutable() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'audit_logs is INSERT-only';
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER audit_immutable
     BEFORE UPDATE OR DELETE ON audit_logs
     FOR EACH ROW EXECUTE FUNCTION raise_audit_immutable();
   ```
3. Document the role separation in `docs/DEPLOY.md`.

**Why this solves the problem.** The audit trail becomes tamper-evident at the lowest layer. Compliance posture improves materially.

**Risk if skipped.** A bug or a compromised app credential can rewrite history.

### 5.4 Audit-table partitioning prep (defer cutover) — 0.5 d

**Problem.** At 100 RPS sustained with ~5 audit emits per write request, audit grows ~13M rows/year. Manageable for 2 years; partitioning is the *next-horizon* problem. But cutover is expensive — better to design queries now so a future partition is trivial.

**Solution.** Document the migration plan; enforce filter discipline now.

**Implementation steps.**
1. New section in `docs/SCALING-NOTES.md` describing the future cutover: range-partition `audit_logs` by `created_at` monthly, retention moving partitions older than 24 months to cold storage tablespace.
2. **Trigger to execute:** audit row count > 50M, **or** p95 single-table query latency on audit_logs exceeds 100ms.
3. Code rule (enforce in PR review): every audit query must filter by `org_id AND created_at` so the future partition pruner can work.

**Why this solves the problem.** When the trigger fires, the cutover is a mechanical migration, not a months-long refactor.

### 5.5 Apply cursor pagination across all list endpoints — 0.5 d

(Bulk of this work happens in Phase 3.5–3.6; this step ensures any new list endpoints from master-plan Phase 3+ also use the shared util.)

**Implementation steps.** Code review checklist: every new list endpoint must use `applyKeysetWhere` from `src/shared/pagination/cursor.ts`. Document in `docs/MODULE-TEMPLATE.md`.

### 5.6 Connection pool sizing & monitoring — 0.5 d

**Problem.** Pool size is configurable via `DATABASE_POOL_MAX_SIZE` in [src/shared/config/env.ts](../src/shared/config/env.ts), but no formula and no monitoring.

**Solution.** Document the formula; expose pool gauges (Phase 4 metrics already cover this).

**Implementation steps.**
1. Document in `docs/DEPLOY.md`: `pool_max = (cores_per_db × 2) + effective_io_concurrency`. For a t3.medium-class Postgres at this scale: 20 connections per HTTP instance, 5 per worker instance.
2. Pool gauges already exposed in Phase 4.2 (`db_pool_total`, `db_pool_idle`, `db_pool_waiting`). Set up a Prometheus alert: `db_pool_waiting > 0 for 5m`.

**Why this solves the problem.** Pool exhaustion becomes a visible alarm, not a mysterious latency spike.

### Phase 5 Verification

- `pg_stat_statements` returns rows; queries above 200ms produce Pino warnings.
- `INSERT INTO audit_logs` works as the app role; `UPDATE`/`DELETE` returns permission denied.
- `EXPLAIN ANALYZE` for the membership query in [src/shared/permissions/guard.ts](../src/shared/permissions/guard.ts) shows index scan, not seq scan.
- All audit queries reviewed include `org_id AND created_at` filters.

---

## Phase 6 — Caching & Storage

**Effort: ~5.5 dev-days · Week 6**

Last because it requires Redis and S3 ops, plus stable observability (Phase 4) to validate hit rates and storage perf.

### 6.1 Combined permission query in guard — 1 d

**Problem.** [src/shared/permissions/guard.ts](../src/shared/permissions/guard.ts) runs one query for membership + role. Then services like [src/modules/org/member.service.ts](../src/modules/org/member.service.ts) re-query membership at the start of nearly every handler (verified at multiple call sites). Most protected requests do 2+ membership queries. The master plan says "no caching of permissions" — it does not say "make N redundant DB calls per request."

**Solution.** Single combined query in the guard; pass result through Fastify request decorator; services consume it instead of re-querying.

**Implementation steps.**
1. In [src/shared/permissions/guard.ts](../src/shared/permissions/guard.ts), replace the membership-only query with a combined select returning `{ membership { id, joinedAt, roleId }, role { isOwner, permissions }, org { id, slug, name, onboardingStep, archivedAt } }`.
2. Decorate `FastifyRequest` with `orgContext: OrgContext` (extend `src/types/fastify.d.ts`).
3. Services accept `orgContext` as an explicit parameter; never re-query.
4. Update controllers to pass `req.orgContext` into service calls.

**Why this solves the problem.** Cuts protected-request DB roundtrips ~2× without violating the principle. (This is plumbing, not caching — the value is computed once per request from authoritative DB state.)

**Risk if skipped.** ~2× DB hit per protected request. Compounds as Phases 3, 4, 5 of master plan add more domains repeating the pattern.

### 6.2 Safe Redis caches (org metadata, invite tokens, system permission set) — 1 d

**Problem.** Public invitation accept/decline endpoints (no auth) run a DB query on every hit. A bot probing invite tokens hits the DB on every probe.

**Solution.** Cache only data the principle does not constrain. **Not** permissions.

**Implementation steps.**
1. New file `src/shared/cache/redis.ts` — a cache-miss-tolerant wrapper. Cache miss must always succeed via DB.
2. Three caches:
   - `system:permissions` — in-process, infinite TTL. The 22-permission constant from `src/shared/permissions/set.ts` (or wherever the constant lives).
   - `org:meta:{orgId}` — Redis, 5 min TTL. `name, slug, onboardingStep, archivedAt`. Explicit `del` on `org:update` and `org:archive` events.
   - `invite:byHash:{tokenHash}` — Redis, 60 s TTL. Used for invitation accept/decline. Explicit `del` on accept/decline; TTL caps blast radius.

**Why this solves the problem.** Reduces DB load on the public surface. Modest cost saver but easy.

**Risk if skipped.** Modest. Mostly relevant if the public invite surface is heavily probed.

### 6.3 Document the permission-cache unlock plan — 0 d (documentation only)

If a future master-plan amendment permits caching, the path is:
- Cache key: `org:{orgId}:perms:{userId}` → `{ isOwner, permissions[], roleId, version }`.
- TTL 30s.
- Invalidation events that must `del` the key: role permission update, role assignment, role revoke, owner promotion, member removal.
- Requires pinning a `version` column on `roles` and `memberships` and bumping on writes.

Documented so the cache shape is on file. **Do not build** unless principles change.

### 6.4 Storage abstraction — 1.5 d

**Problem.** Master plan Phase 4 (minutes export) and Phase 5 (audit export) need to produce files. Generating a 50 MiB PDF inside a request handler will OOM and time out.

**Solution.** A `Storage` interface with local-disk dev impl and S3 prod impl.

**Implementation steps.**
1. New folder `src/shared/storage/`:
   - `storage.ts` — interface `Storage { put(key, body, contentType): Promise<URL>; getSignedUrl(key, ttlSeconds): Promise<URL>; }`.
   - `local.disk.ts` — dev implementation writing under `.dev-storage/`, served via a Fastify static plugin route gated by a signed query token. Useful for tests and local dev.
   - `s3.ts` — production via AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
2. `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.
3. Add to [src/shared/config/env.ts](../src/shared/config/env.ts): `STORAGE_BACKEND: 'local' | 's3'`, `S3_BUCKET`, `AWS_REGION` (when `STORAGE_BACKEND=s3`).

**Why this solves the problem.** Future export endpoints use one interface. Dev stays simple.

### 6.5 Export job pattern (codified, not yet built) — 1 d

When master plan Phase 4 or 5 ships export endpoints, follow this pattern:

1. `POST /orgs/:orgId/audit/export` — validates request, enqueues `export-audit` BullMQ job, returns `{ jobId }` immediately (HTTP 202).
2. Worker generates the file in the worker process (using the worker entrypoint from Phase 2.3), uploads to S3 under `exports/{orgId}/{jobId}.csv`, emits `audit.exported` audit row.
3. `GET /orgs/:orgId/exports/:jobId` — returns `{ status: 'pending' | 'ready' | 'failed', signedUrl? }`. Signed URL TTL: 5 min.

**Why this solves the problem.** Streaming inside the request path violates the body-limit safety from Phase 1.7 and risks request timeouts on large datasets.

### 6.6 Wire Redis store into rate-limit (from Phase 1.1) — 0.5 d

Once Redis is available, switch `@fastify/rate-limit` to its Redis store. Multi-instance HTTP becomes safe.

**Why this solves the problem.** In-memory rate-limit state is per-instance — three HTTP instances allow 3× the configured rate. Redis-backed rate-limit is global.

### 6.7 Wire Redis to readiness probe — 0.25 d

In `/health/ready` from Phase 1.5, add a Redis `PING`. Returns 503 if Redis is down.

### Phase 6 Verification

- A protected request runs exactly one membership/role query (verified via `pg_stat_statements`).
- Updating an org name and refetching reflects within one request (cache invalidated).
- `STORAGE_BACKEND=local` write/read round-trip works in dev.
- `STORAGE_BACKEND=s3` returns a signed URL that fetches the uploaded file.
- Three HTTP instances behind a load balancer share rate-limit state (one client gets 429 even when bouncing between instances).

---

## Phase 7 — Security & Policy

**Effort: ~2.5 dev-days · Week 7**

Final hardening. JWT rotation runbook, audit-access logging, cookie flags audit. Most master-plan Phase 5 security items map here.

### 7.1 JWT secret rotation strategy — 1.5 d

**Problem.** [src/shared/config/env.ts](../src/shared/config/env.ts) holds a single `JWT_SECRET`. Rotating it requires a downtime window during which all existing access tokens are invalid. There's no support for multiple keys.

**Solution.** Multi-key support with `kid` header.

**Implementation steps.**
1. Replace `JWT_SECRET` with `JWT_SECRETS` — JSON `{ kid: secret }` entries, e.g. `{"v1": "...", "v2": "..."}`.
2. Add `JWT_CURRENT_KID` env to indicate which key signs new tokens.
3. In [src/shared/auth/jwt.ts](../src/shared/auth/jwt.ts):
   - `signAccessToken` includes `header: { kid: JWT_CURRENT_KID }`.
   - `verifyAccessToken` reads the `kid` from the token header and verifies against the matching secret.
4. Rotation runbook in `docs/SECURITY.md`:
   - Deploy 1: add new `kid` to `JWT_SECRETS`. Verifier accepts both.
   - Deploy 2: switch `JWT_CURRENT_KID` to the new key. Old tokens still verify.
   - Deploy 3 (after access-token TTL has elapsed): remove the old key from `JWT_SECRETS`.

**Why this solves the problem.** Compromised secret rotation no longer requires forced logouts.

**Risk if skipped.** Compromised secret = all-user logout window. PR review may also block compliance audits.

### 7.2 Audit-access logging — 0.5 d (when audit module ships in master plan Phase 5)

**Problem.** Master-plan principle 1 makes audit INSERT-only at write. But who reads audit? Without read-side logging, an attacker who exfiltrates the access token of a member with `audit:view` can browse all audit history undetected.

**Solution.** Every `SELECT` on `audit_logs` from API endpoints emits its own audit row (`audit.viewed`).

**Implementation steps.** Implement when the audit list endpoint ships. The handler emits an `audit.viewed` row inside the same `withTx` as the read query.

**Why this solves the problem.** Tampering visibility for the audit trail itself.

### 7.3 Cookie flags audit (review) — 0.25 d

Already centralized in Phase 1.6. Phase 7 just verifies in production:
- Refresh cookie response header in prod includes `httpOnly; secure; sameSite=strict; path=/api/v1/auth`.
- No `domain` setting.

### 7.4 Refresh-token reuse handling — already correct

[src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) `refresh` invalidates **all** refresh tokens for a user when a token is presented and not found. This is the OWASP-recommended pattern for refresh-token reuse detection. Document it in `docs/SECURITY.md` as the gold standard. **Do not change it.**

### Phase 7 Verification

- Rotating `JWT_CURRENT_KID` after deploying a new key in `JWT_SECRETS` does not cause refresh failures.
- Production cookie `Set-Cookie` header includes all five flags from Phase 1.6.
- (Future) `audit.viewed` audit rows appear after each audit-list query.

---

## When to Break the Monolith — Decision Triggers (Layer K)

Quarterly review. **Do not extract** until at least one trigger fires.

| Trigger | Threshold | Likely extraction |
|---------|-----------|-------------------|
| Audit ingest rate | > 1k events/sec sustained over 1h | Audit ingestion service backed by a log-structured store (e.g., ClickHouse) |
| Notification volume | > 10k emails/day, **or** SMTP-bound CPU > 30% on workers for > 7 days | Notifications worker with its own deploy cadence and scaling group |
| Module deploy contention | > 2 incidents/quarter where a deploy of one module is blocked by another's regression | Extract the *blocked* module |
| DB pool saturation | `pool_waiting > 0` for > 5% of 1-min windows over 7 days **AND** p95 read query > 50ms | Read replica first; extraction last |
| Auth attack surface | Sustained credential-stuffing requiring isolation of auth from main app | Extract `auth` to a dedicated process behind separate WAF rules |

If none fire: the monolith is the right answer. The architecture this plan describes is *designed* to defer this decision indefinitely while keeping eventual extraction cheap.

---

## Layer Summary (Reference Index)

| Layer | Phase | Must-have | Nice-to-have | Defer |
|-------|-------|-----------|--------------|-------|
| A. Ops hardening | 1 | Rate limit, graceful shutdown, request IDs, helmet, /health/live + /health/ready, body limits | Log redactions, log sampling | Per-route response caching |
| B. Async work | 2 | Notification dispatcher abstraction, BullMQ prod, expired-OTP/invite cleanup workers, separate `worker.ts` | Webhook delivery, scheduled report jobs | Multi-tenant queue isolation |
| C. Caching | 6 | Combined permission query in guard, request-scoped permission context | Redis cache for org metadata, invite-token TTL cache | Permission caching (forbidden) |
| D. DB | 5 | Pool monitoring, `pg_stat_statements`, index audit, audit-log INSERT-only DB grant | Slow-query alerts, partition prep migration | Read replicas, sharding, partitioning live cutover |
| E. Pagination | 3 | Shared opaque keyset cursor util, fix [src/modules/org/member.repository.ts](../src/modules/org/member.repository.ts) cursor stub | Limit caps enforced at schema layer | Offset pagination anywhere |
| F. Storage | 6 | S3 abstraction with local-disk dev impl, signed-URL exports | Multi-bucket per-tenant scoping | CDN |
| G. Observability | 4 | OpenTelemetry traces, `/metrics` Prometheus endpoint, error reporting hook | Audit-rate dashboard, queue-depth alerts | APM vendor lock-in |
| H. Module discipline | 3 | `public.ts` module API, ESLint `no-restricted-imports`, fix cross-module leaks | In-process event bus | Inter-module DB joins |
| I. CI/CD | 1 | Migration dry-run job, vitest gate, coverage threshold, lock-file integrity, drift check | Drizzle diff check, dependency vuln scan | Auto-deploy to prod |
| J. Security | 7 | Body limits, secrets rotation runbook, audit-access logging, cookie flags | JWT `kid` rotation | mTLS to internal services |
| K. Decision triggers | n/a | Trigger thresholds doc | Quarterly review checklist | None |

---

## Critical Files To Be Created

- `src/worker.ts` — separate process entrypoint for queue and cleanup workers (Phase 2.3).
- `src/tracing.ts` — OpenTelemetry SDK init (Phase 4.1).
- `src/shared/notifications/dispatcher.ts` — async dispatcher abstraction (Phase 2.1).
- `src/shared/queue/bullmq.ts` — Redis queue client (Phase 2.2).
- `src/shared/queue/jobs/{cleanup-otps,expire-invites,cleanup-refresh}.ts` — three cleanup jobs (Phase 2.4).
- `src/shared/cache/redis.ts` — safe (cache-miss-tolerant) cache wrapper (Phase 6.2).
- `src/shared/storage/{storage,local.disk,s3}.ts` — storage abstraction (Phase 6.4).
- `src/shared/pagination/cursor.ts` — opaque keyset cursor util (Phase 3.5).
- `src/shared/pagination/README.md` — pagination contract (Phase 3.5).
- `src/shared/http/metrics.plugin.ts` — Prometheus exposition (Phase 4.2).
- `src/shared/http/context.ts` — request-id and orgContext plumbing (Phase 1.3).
- `src/shared/auth/cookies.ts` — centralized cookie issuing (Phase 1.6).
- `src/shared/events/bus.ts` — in-process event bus (Phase 3.7, optional).
- `src/shared/errors/reporter.ts` — Sentry-compatible error reporter (Phase 4.3).
- `src/modules/auth/public.ts`, `src/modules/org/public.ts` — module API surfaces (Phase 3.1).
- `docs/MIGRATION-SAFETY.md`, `docs/MODULE-TEMPLATE.md`, `docs/SECURITY.md`, `docs/DEPLOY.md`, `docs/SCALING-NOTES.md`.
- New migrations: `pg_stat_statements`, audit-log REVOKE/GRANT + immutability trigger, missing indexes per audit (Phase 5.2).

## Critical Files To Be Modified

- [src/main.ts](../src/main.ts) — graceful shutdown, OTel preload (Phase 1.2 + 4.1).
- [src/app.ts](../src/app.ts) — helmet, rate-limit, request IDs, body-limit, JSON-only logger in prod (Phase 1).
- [src/shared/permissions/guard.ts](../src/shared/permissions/guard.ts) — combined orgContext query, request decoration (Phase 6.1).
- [src/modules/org/member.service.ts](../src/modules/org/member.service.ts) — remove cross-module reach into auth tables (Phase 3.3).
- [src/modules/org/member.repository.ts](../src/modules/org/member.repository.ts) — implement keyset cursor pagination (Phase 3.6).
- [.github/workflows/CI.yml](../.github/workflows/CI.yml) — test job, drift check, frozen lockfile (Phase 1.8 + 1.9).
- [src/shared/config/env.ts](../src/shared/config/env.ts) — `REDIS_URL`, `METRICS_TOKEN`, `STORAGE_BACKEND`, `JWT_SECRETS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`.
- [eslint.config.js](../eslint.config.js) — `no-restricted-imports` (Phase 3.2).
- [src/shared/errors/envelope.ts](../src/shared/errors/envelope.ts) — error reporter hook (Phase 4.3).
- [src/shared/database/client.ts](../src/shared/database/client.ts) — export pool, query event hook (Phase 1.2 + 5.1).
- [src/shared/http/health.ts](../src/shared/http/health.ts) — split into `/live` and `/ready` (Phase 1.5 + 6.7).
- [src/shared/logger/index.ts](../src/shared/logger/index.ts) — redactions, prod JSON (Phase 1.4).
- [src/shared/auth/jwt.ts](../src/shared/auth/jwt.ts) — multi-kid support (Phase 7.1).
- [src/shared/audit/emitter.ts](../src/shared/audit/emitter.ts) — `requestId` in payload, `audit_emit_total` counter (Phase 1.3 + 4.2).
- [src/shared/notifications/service.ts](../src/shared/notifications/service.ts) — lazy SMTP transport, worker-side consumer (Phase 2.1).
- [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) — dispatcher.enqueue calls, `createUserFromInvitation` export (Phase 2.1 + 3.3).
- [src/modules/auth/auth.controller.ts](../src/modules/auth/auth.controller.ts), [src/modules/org/member.controller.ts](../src/modules/org/member.controller.ts) — use centralized cookie helpers (Phase 1.6).
- [tsup.config.ts](../tsup.config.ts) — second entrypoint for worker (Phase 2.3).
- [package.json](../package.json) — `pnpm worker`, `pnpm dev:worker` scripts; updated `start` for OTel preload (Phase 2.3 + 4.1).
- [docker-compose.yml](../docker-compose.yml) — add `worker` service, add `redis` service (Phase 2.3 + 6).

---

## End-to-End Verification (After Full Rollout)

A 30-minute checklist per environment promotion:

1. **Phase 1 — Operational Floor**: rate-limit returns 429 · SIGTERM drains gracefully · `/health/live` works without DB · helmet headers present · `reqId` on every log · CI runs tests + drift check.
2. **Phase 2 — Async Work**: register a user with SMTP paused — response < 50ms · queue depth visible at `/metrics` · cleanup workers logged a `system.cleanup` audit row in last 24h · separate worker process running.
3. **Phase 3 — Module Discipline**: `pnpm lint` rejects a deliberate cross-module import · `member.service.ts` no longer touches `@/db/schema/auth` · cursor pagination constant-time at page 500.
4. **Phase 4 — Observability**: register → verify trace shows SMTP enqueue and DB transaction as sibling spans · `/metrics` returns Prometheus exposition with `audit_emit_total` and `db_pool_*` · unexpected error appears in error reporter.
5. **Phase 5 — DB & Data Shape**: `INSERT INTO audit_logs` works · `UPDATE audit_logs` denied · all master-plan indexes present · slow queries logged.
6. **Phase 6 — Caching & Storage**: protected request runs exactly one membership query · org-meta cache invalidated on update · export job returns `jobId` in <100ms and resolves to a signed URL within minutes · multi-instance rate-limit shares state via Redis.
7. **Phase 7 — Security**: JWT rotation with new `kid` succeeds without forcing logouts · cookie flags verified in prod headers.

If all seven sections pass, the system is at the design point of this plan.

---

## Effort Recap (At a Glance)

| Phase | Effort | Calendar position |
|-------|--------|-------------------|
| 1. Operational Floor | ~5 d | Week 1 |
| 2. Async Work & Queues | ~5.5 d | Week 2 |
| 3. Module Discipline | ~5.5 d | Week 3 |
| 4. Observability | ~3.5 d | Week 4 (first half) |
| 5. DB & Data Shape | ~4 d | Week 4–5 |
| 6. Caching & Storage | ~5.5 d | Week 6 |
| 7. Security & Policy | ~2.5 d | Week 7 |
| **Total** | **~31 dev-days** | **~7 calendar weeks of focused work · realistically 8–10 weeks with reviews and integration** |

Phases 1–3 unlock everything else. Phases 4–7 can be parallelized across two engineers if available; without parallelism, the order above is correct.
