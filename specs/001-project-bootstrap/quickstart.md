# Quickstart: Phase 0 Verification

**Feature**: 001-project-bootstrap
**Audience**: Operators and developers verifying that Phase 0 is complete

This is the end-to-end checklist. After running these steps, every Phase 0 Done When
criterion from the implementation plan should be visibly satisfied.

---

## Prerequisites

- Node.js 24 LTS installed
- pnpm 10.x installed (`npm install -g pnpm`)
- Docker Desktop (or any docker-compose-compatible runtime) running
- A clone of the repository on `001-project-bootstrap` branch

---

## 1. Install Dependencies

```bash
pnpm install
```

Expected: install completes without warnings; lockfile updated.

---

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:
- `DATABASE_URL=postgres://groven:groven@localhost:5432/groven_dev`
- `JWT_SECRET=<paste 32+ random characters>`
- `SMTP_FROM=noreply@groven.local`

---

## 3. Start Local Services

```bash
docker compose up -d
```

Brings up:
- Postgres 17 on `localhost:5432` (creds match `.env.example`)
- Mailpit on `localhost:1025` (SMTP) and `localhost:8025` (web UI)

Verify with `docker compose ps` that both services are `healthy`.

---

## 4. Run Migrations

```bash
pnpm db:migrate
```

Expected output:
- `Acquired migration advisory lock`
- `Applied migration 0000_init.sql`
- `Released migration advisory lock`

Verify all 17 tables exist:

```bash
docker compose exec postgres psql -U groven -d groven_dev -c "\dt"
```

You should see 17 rows in the listing (users, email_verifications, refresh_tokens,
organizations, roles, memberships, invitations, meetings, meeting_agenda_items,
meeting_attendees, votes, vote_eligibility, ballots, minutes, minutes_resolutions,
minutes_corrections, audit_logs).

---

## 5. Verify Startup Validation (FR-007 / SC-004)

Temporarily remove `JWT_SECRET` from `.env` and try to start the server:

```bash
pnpm dev
```

Expected: process exits with non-zero code within 5 seconds and prints a message
identifying `JWT_SECRET` as missing/invalid. Restore `JWT_SECRET` before continuing.

Now repeat with all variables present:

```bash
pnpm dev
```

Expected: server logs `listening on http://localhost:3000` (structured JSON).

---

## 6. Verify Health Check (FR-009 / SC-006)

In a second terminal:

```bash
curl -s http://localhost:3000/health | jq
```

Expected:
```json
{
  "success": true,
  "data": { "status": "ok", "timestamp": "2026-05-01T..." }
}
```

Now stop the Postgres container:

```bash
docker compose stop postgres
```

Hit `/health` again:

```bash
time curl -i http://localhost:3000/health
```

Expected: HTTP 503, returned within 2 seconds, body in error envelope shape.

Restart Postgres:

```bash
docker compose start postgres
```

---

## 7. Verify Concurrent Migration Safety (SC-007)

From two separate terminals, run simultaneously:

```bash
# Terminal A
pnpm db:migrate
```

```bash
# Terminal B (within ~1 second of Terminal A)
pnpm db:migrate
```

Expected: one terminal acquires the advisory lock and applies migrations (or finds
none pending). The other waits for the lock, acquires it, finds no pending work, and
exits cleanly. Schema remains valid in either order.

---

## 8. Run Tests

```bash
pnpm test
```

Expected:
- All unit tests pass (covers env validation, error envelope, audit emitter type
  guard, permission set lookup).
- All integration tests pass (covers health endpoint, migration runner, permission
  guard against real Postgres, audit-emitter rollback behavior — SC-003).
- Coverage report shows ≥ 80% lines and ≥ 80% branches (Constitution II).

---

## 9. Run Lint

```bash
pnpm lint
```

Expected: zero warnings, zero errors (Constitution I).

---

## Phase 0 Done When (mapped from implementation plan)

| Criterion | Verified by |
|-----------|-------------|
| All 17 tables migrate cleanly from a blank database | Step 4 |
| Server refuses to start with required env var missing | Step 5 |
| System permission set is accessible as a typed constant | Unit test (Step 8) |
| Error types and response helpers produce the correct envelope shapes | Unit test (Step 8) |
| Audit Emitter is importable and callable inside a transaction | Integration test (Step 8) |
| Notification Service abstraction is wired to a working delivery mechanism | Integration test (Step 8) — sends via Mailpit |
| Permission Guard correctly resolves membership and enforces Owner bypass | Integration test (Step 8) |

If every step passes, Phase 0 is complete and ready to begin Phase 1 (`/speckit-tasks`
followed by `/speckit-implement`).
