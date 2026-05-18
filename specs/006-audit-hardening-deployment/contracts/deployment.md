# Internal Contract: Deployment, Hardening & API Gateway

**Feature**: 006-audit-hardening-deployment

This contract fixes the production-deployment surface: the API-gateway
rate-limit configuration (delegated, not application code), the security
headers, the health endpoints, the container, the startup sequence, and the
configuration reference. It satisfies FR-510 … FR-520.

---

## 1. Rate limiting — delegated to the API gateway (FR-510 / FR-511)

The application implements **no** rate limiting. It is deployed **behind a cloud
provider's API gateway / edge layer**, and the gateway enforces the limits.
This contract fixes only the *policy*; concrete thresholds and window durations
are gateway configuration chosen at deploy time.

| Endpoint                          | Limit policy                                  |
| --------------------------------- | --------------------------------------------- |
| `POST /api/v1/auth/register`      | Per request source, per time window           |
| `POST /api/v1/auth/login`         | Per request source, per time window           |
| `POST /api/v1/auth/resend-otp`    | Per request source — **strictest** of the three |

- The gateway rejects over-limit requests with a standard **429 Too Many
  Requests**; it resumes accepting once the window elapses — **no permanent
  lockout**.
- The application ships no rate-limit middleware, no `@fastify/rate-limit`
  dependency, and no counter store. This keeps the app stateless (FR-517) and
  consistent across replicas.
- **Verification** of FR-510/FR-511 is performed against the deployed gateway,
  not by an application test (spec User Story 4 "Independent Test").

---

## 2. Security headers (FR-512) — application responsibility

Set by `@fastify/helmet` (already registered in `src/app.ts`). Every response
from every endpoint MUST carry:

| Header                      | Value / behaviour                         |
| --------------------------- | ----------------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                 |
| `X-Frame-Options`           | `DENY` (clickjacking protection)          |
| `Strict-Transport-Security` | Present **only when `NODE_ENV=production`** |

The HSTS header is gated on the production environment — the helmet `hsts`
option is applied conditionally so non-production responses do not advertise
HTTPS-only.

---

## 3. Health endpoints (FR-513)

Two unauthenticated routes, no permission, no onboarding gate:

| Route                  | Probe        | 200 body                                | Non-200                                  |
| ---------------------- | ------------ | --------------------------------------- | ---------------------------------------- |
| `GET /health/live`     | none         | `{ status: "live", timestamp }`         | —                                        |
| `GET /health/ready`    | `SELECT 1`   | `{ status: "ready", timestamp }`        | `503 { status: "unavailable", timestamp }` |

- `timestamp` is ISO-8601 UTC.
- Liveness performs **no** dependency probe — a DB outage must not cause pod
  restarts. Readiness probes the **database only** (not Redis/SMTP).
- The stray debug route `GET /protected` is removed from the health plugin.

---

## 4. Container (FR-517)

A multi-stage `Dockerfile` at the repository root:

```
# builder  — node:24
#   pnpm install (all deps)  →  pnpm build (tsup → dist/)
# runtime  — node:24-slim
#   pnpm install --prod  ; COPY dist/ , src/db/migrations/
#   CMD: node --import ./dist/tracing.js ./dist/main.js
```

- `src/db/migrations/` MUST be present in the runtime image — `runMigrations`
  reads the `.sql` files from that folder at startup.
- The image holds **no session state** — all session state lives in
  `refresh_tokens`; multiple replicas may run behind a load balancer.
- `docker-compose.yml` remains a **local-development** infrastructure bundle
  (Postgres, Jaeger, Prometheus, Grafana) — it is **not** the production unit.

---

## 5. Startup sequence (FR-514 / FR-515 / FR-516)

Order enforced by `src/shared/config/env.ts` + `src/main.ts`:

1. **Validate configuration** — the Zod schema in `env.ts` parses
   `process.env`; any missing/invalid variable → log + `process.exit(1)`
   **before** anything else. Secret variables (`JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET`) carry a `.min(32)` constraint — a too-short secret is
   treated exactly like a missing one.
2. **Run migrations** — `runMigrations(db)` applies all outstanding migrations
   (including `0004_audit_append_only`) under an advisory lock. If migrations
   fail, the process throws and never calls `listen()`.
3. **Start the HTTP server** — `app.listen()` only after 1 and 2 succeed.

The system never serves traffic in a partially configured or unmigrated state.

---

## 6. Configuration reference — `.env.example` (FR-518)

`.env.example` is rewritten to list **every** variable the `env.ts` schema
reads, each with a comment stating its purpose and whether it is **required** or
has a **default**. It MUST stay in sync with the schema (drift blocks merge).
Variables, grouped:

- **Environment/server** — `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`,
  `APP_BASE_URL`, `HELMET_HSTS_MAX_AGE`, `MAX_BODY_LIMIT` (all required)
- **Database** — `DATABASE_URL`, `DATABASE_POOL_MAX_SIZE` (required),
  `DB_SLOW_QUERY_THRESHOLD_MS` (default 200)
- **Redis/queue** — `REDIS_URL` (required), `QUEUE_BACKEND` (default `redis`)
- **JWT** — `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (required, min 32 chars)
- **SMTP** — `SMTP_HOST`, `SMTP_FROM` (required), `SMTP_PORT` (default 587),
  `SMTP_USER`, `SMTP_PASSWORD` (optional)
- **OpenTelemetry** — `OTEL_EXPORTER_OTLP_ENDPOINT` (required),
  `OTEL_SERVICE_NAME` / `OTEL_SERVICE_VERSION` (defaults)
- **Sentry** — `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (optional)

The current `.env.example` lists `JWT_SECRET` / `COOKIE_SECRET` (names the
schema does not read) and omits many required variables — it is corrected to the
authoritative list above.

---

## 7. API documentation (FR-519)

- Every route — including the two new audit routes and the two health routes —
  carries a Zod schema covering request shape, success response, and every
  error response it can produce; `@fastify/swagger` generates the OpenAPI
  document from those schemas.
- An `Audit` tag is added to the swagger `tags` array and to the
  `tagBySegment` map in `app.ts`.
- The missing `src/scripts/gen-openapi.ts` (already referenced by the
  `gen:openapi` package script) is created so the spec can be emitted to a file
  in CI.

---

## 8. Structured logging (FR-520)

- Pino (`src/shared/logger`) emits JSON in production — already compliant.
- `src/main.ts`'s shutdown-timeout `console.error` is replaced with
  `logger.error`.
- The `console.error` in `env.ts`'s invalid-config branch is **retained** as a
  documented bootstrap exception — it runs before the logger module (which
  imports `env`) can be constructed.
- No other plain-text log statements appear on production code paths.
