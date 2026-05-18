# Quickstart: Audit, Hardening & Deployment

**Feature**: 006-audit-hardening-deployment
**Date**: 2026-05-18

End-to-end verification walkthrough. Confirms the audit query/export module, the
audit-trail integrity guarantees, the security hardening, and the deployment
readiness criteria. Run against a clean database.

> **Precondition:** the committed merge-conflict markers in `src/app.ts` and
> `src/shared/audit/emitter.ts` are resolved and the project compiles
> (`pnpm type-check` passes). This is task zero — see research.md.

## 0. Bring the system up from a blank environment

```bash
cp .env.example .env.development        # fill in real values
docker compose up -d postgres redis     # local infra
pnpm install
pnpm dev                                # migrations run, then server listens
```

Expect the logs: advisory lock acquired → migrations completed (including
`0004_audit_append_only`) → server listening. **SC-511.**

## 1. Health endpoints (FR-513, SC-509)

```bash
curl -s localhost:3000/api/v1/health/live    # 200 {status:"live", timestamp}
curl -s localhost:3000/api/v1/health/ready   # 200 {status:"ready", timestamp}
```

Stop Postgres, call `/health/ready` again → `503 {status:"unavailable",...}`
while `/health/live` still returns `200`. Restart Postgres.

## 2. Run the full governance flow (seeds the audit log)

Exercise every audited operation — register → verify → create org → create role
→ invite member → accept → create meeting → add attendees → open meeting →
create vote → cast ballots → close vote → complete meeting → create minutes →
attach resolution → finalize → export minutes. **SC-513.**

## 3. Query the audit log (US1 — FR-501 … FR-504)

```bash
# audit:view holder
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/v1/audit/org/$ORG"
```

Verify: entries newest-first; each has actor, event, entityType, entityId,
payload, ISO timestamp; a `nextCursor` when more pages exist; following the
cursor yields the next page with no gaps/duplicates. Apply each filter
(`actorId`, `event`, `entityType`, `entityId`, `from`, `to`) individually and
combined → result narrows with AND semantics. `from` later than `to` → empty
list, not an error. A member without `audit:view` → `403 FORBIDDEN`. A member of
another org never sees these entries. **SC-502, SC-503.**

## 4. Redaction (FR-504a, SC-504a)

In a query and an export, inspect every `payload`. No `passwordHash`,
`password`, `otpHash`, `tokenHash`, `refreshTokenHash`, `accessToken`, or
`inviteTokenHash` key appears. Confirm directly in the DB that the stored
`audit_logs.payload` still contains those fields — redaction is read-time only.

## 5. Export the audit log (US2 — FR-505 / FR-506)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/v1/audit/org/$ORG/export?format=csv" -o audit.csv
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/v1/audit/org/$ORG/export?format=pdf" -o audit.pdf
```

CSV opens as a valid flat file; PDF opens as a readable document. For an
identical filter set, the export contains exactly the entries the query returns
across all pages (no page cap). A zero-match filter set still yields a
well-formed file (CSV header only). `?format=xlsx` → `400 VALIDATION_ERROR`.
A member without `audit:export` → `403 FORBIDDEN`. **SC-504.**

## 6. Audit-trail integrity (US3 — FR-507 … FR-509)

- **Append-only**: `UPDATE audit_logs SET event='x'` and
  `DELETE FROM audit_logs` via the application's DB credentials → both rejected
  by Postgres with `audit_logs is append-only`. **SC-505.**
- **Completeness**: after the full flow, `SELECT DISTINCT event FROM audit_logs`
  → all **29** registered event types present, each operation producing exactly
  one entry. **SC-501.**
- **Transactionality**: force an operation to fail mid-transaction → no audit
  entry survives the rollback. **SC-506.**

## 7. Security headers (FR-512, SC-508)

Inspect any response: `X-Content-Type-Options: nosniff` and
`X-Frame-Options: DENY` present everywhere; `Strict-Transport-Security` present
only with `NODE_ENV=production`.

## 8. Rate limiting (FR-510 / FR-511) — gateway, not the app

Verified against the deployed API gateway, not the application: hit
`/auth/register`, `/auth/login`, `/auth/resend-otp` from one source past the
configured threshold → gateway returns `429`; requests resume after the window;
the resend-otp limit is the strictest. The application has no rate-limit code.

## 9. Misconfiguration refuses to start (FR-514 / FR-515, SC-510)

Remove a required variable → server exits before listening. Set
`JWT_ACCESS_SECRET` to a 10-char value → server exits (secret below 32-char
minimum). Start with Postgres unreachable → migration step fails fast, server
never listens.

## 10. Documentation (FR-518 / FR-519, SC-512)

`.env.example` lists every schema variable with purpose and required/default.
`/docs` (development) renders the OpenAPI UI; every endpoint — including the two
audit routes — shows request, success, error responses, and required
permission.

## 11. Container (FR-517)

```bash
docker build -t groven-iq .
docker run --env-file .env.production -p 3000:3000 groven-iq
```

Container starts from a blank environment, applies migrations, becomes healthy.

## 12. Structured logs (FR-520, SC-515)

With `NODE_ENV=production`, every log line is a JSON record — no plain-text log
statement on any production code path.
