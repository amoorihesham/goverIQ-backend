# Deployment Notes

## PostgreSQL Configuration

The application expects the following `postgresql.conf` settings in production:

```conf
# Required for pg_stat_statements extension (loaded at server start)
shared_preload_libraries = 'pg_stat_statements'

# Per-query slow log: anything >= 200ms is written to the Postgres log
log_min_duration_statement = 200ms

# pg_stat_statements tuning
pg_stat_statements.max = 10000
pg_stat_statements.track = all
```

Changing `shared_preload_libraries` requires a **Postgres restart**. After
restart, the `0002_enable_pg_stat_statements` migration will create the
extension. On AWS RDS / Aurora this is gated on the parameter group being
attached and the cluster being rebooted.

Verify the extension is live:

```sh
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_stat_statements;"
```

### Application-side slow query logging

In addition to the DB-side log above, the Node process wraps `pg.Pool.query`
and per-connection `client.query` to emit a `pino.warn` (`'slow query'`) for
any query whose total wall-clock (including pool wait + network) exceeds
`DB_SLOW_QUERY_THRESHOLD_MS` (default 200ms). See
[src/shared/database/instrumentation.ts](../src/shared/database/instrumentation.ts).

Tune the threshold per environment via `.env`:

```
DB_SLOW_QUERY_THRESHOLD_MS=200
```

Logged fields: `duration_ms` (rounded), `sql` (parameterized text — `$1`,
`$2` placeholders, never bound values, so this is safe to ship to log
aggregation). Disabled when `NODE_ENV=test`.

## Rate Limiting (Cloudflare)

Rate limiting is **not** implemented in the codebase. It is enforced at the
edge by Cloudflare. See [SCALE_PLAN.md §1.1](SCALE_PLAN.md) for the
architectural decision and rationale.

### Mandatory: Cloudflare-only ingress

The origin **must** reject any request that did not transit Cloudflare. If
the origin IP is reachable directly, attackers bypass every rule below and
the app has no defense-in-depth fallback (the in-app limiter was
deliberately not built). Two acceptable mechanisms:

1. **Cloudflare Authenticated Origin Pulls (mTLS).** Origin verifies a
   Cloudflare-issued client certificate on every connection. Strongest
   option.
2. **Origin firewall allowlist of Cloudflare IP ranges**, refreshed on a
   schedule from `https://www.cloudflare.com/ips/`
   (`https://www.cloudflare.com/ips-v4` and
   `https://www.cloudflare.com/ips-v6`).

Pick one before opening the origin to the internet.

### Required Cloudflare Rate Limiting Rules

Configure the following four rules **before** allowing production traffic.
All four are keyed on client IP and return HTTP 429 on threshold breach.

| Path                       | Method | Limit | Window | Key       |
| -------------------------- | ------ | ----- | ------ | --------- |
| `/api/v1/*` (catch-all)    | any    | 600   | 1 min  | client IP |
| `/api/v1/auth/login`       | POST   | 10    | 1 min  | client IP |
| `/api/v1/auth/register`    | POST   | 5     | 1 min  | client IP |
| `/api/v1/auth/refresh`     | POST   | 30    | 1 min  | client IP |

### Custom 429 response (Pro+)

Set a Cloudflare Custom Response on the rules above so the frontend handles
one error envelope shape:

```
Content-Type: application/json
```

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "statusCode": 429
  }
}
```

### TODO — `/auth/resend-otp` body-keyed limit

The original scaling plan keyed `/auth/resend-otp` on `sha256(body.email)`
(3 / 15 min) to bound SMTP cost regardless of the attacker's IP rotation.
Cloudflare's standard Rate Limiting Rules cannot key on a request-body
field. **Pick one of the three options below before going live**, and
document the choice in this section:

- **Cloudflare Enterprise Advanced Rate Limiting** — body-field keys are
  native. Cleanest, but the most expensive plan tier.
- **Cloudflare Worker on `/api/v1/auth/resend-otp`** — Worker parses the
  body, hashes the email, rate-limits via KV (eventually consistent, fine
  for this limit) or Durable Objects (strongly consistent). Cheap on any
  plan; the rate-limit logic moves to Workers JS at the edge.
- **Accept per-IP-only protection** — drop the email-keyed bucket and rely
  on the `/api/v1/auth/*` global rules. A botnet rotating residential IPs
  can still target a single victim email for SMTP flooding. Acceptable for
  early-stage; revisit if SMTP bills or abuse reports demand it.

### Verification

After applying Cloudflare configuration:

1. From an IP not previously seen, burst-call the login endpoint and
   expect 429 after the documented threshold:

   ```sh
   for i in $(seq 1 20); do \
     curl -s -o /dev/null -w "%{http_code}\n" \
       -X POST "https://<prod-host>/api/v1/auth/login" \
       -H "Content-Type: application/json" \
       --data '{"email":"smoke@test","password":"x"}'; \
   done
   ```

   Expect `200`/`401` for the first 10 requests, then `429` for the
   remainder of the window.

2. Probe the origin directly (bypassing Cloudflare) and confirm it
   refuses the connection:

   ```sh
   curl -v --resolve "<prod-host>:443:<origin-ip>" \
     "https://<prod-host>/api/v1/auth/login"
   ```

   Expect a TLS handshake failure (Authenticated Origin Pulls) or a 403
   from the origin firewall — **not** a successful response.

3. Confirm the custom 429 response shape matches the JSON envelope above
   by inspecting one of the throttled responses from step 1.
