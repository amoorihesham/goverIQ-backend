# Internal Contract: Audit Payload Redaction

**Feature**: 006-audit-hardening-deployment
**Module**: `src/shared/audit/redact.ts`

This is not an HTTP contract — it is the internal contract between the audit
`emitter` (write side, untouched) and the audit `query` / `export` paths (read
side). It satisfies FR-504a and SC-504a.

## Guarantee

For any stored `audit_logs.payload`, the value returned by the audit query and
the value written into an audit export are produced by **one and the same
function**, `redactAuditPayload`. Therefore, for any filter set, query and
export return **byte-identical** redacted payloads. The stored row is **never**
modified — redaction is purely a read-time transform.

## Deny-list

```ts
export const AUDIT_REDACTION_DENYLIST = Object.freeze([
  'passwordHash',
  'password',
  'otpHash',
  'tokenHash',
  'refreshTokenHash',
  'refreshTokenCleartext',
  'accessToken',
  'inviteTokenHash',
] as const);
```

- The list is a **single, central, frozen** constant. Neither the query module
  nor the export module defines its own list or its own copy.
- Matching is by **key name**, case-sensitive, at **any depth** of the payload
  object (`{ before, after }`, `{ data }`, and any nested object inside them).
- The list aligns with the field names already redacted by Pino in
  `src/shared/logger/index.ts` — one definition of "what is secret".

## Function contract

```ts
function redactAuditPayload(payload: unknown): unknown;
```

- **Pure** — no I/O, no clock, no DB, no Fastify. Trivially unit-testable.
- **Non-mutating** — returns a new structure; the input object (and the stored
  row it came from) is left untouched.
- **Deep** — recursively walks plain objects and arrays. Any object key whose
  name is in `AUDIT_REDACTION_DENYLIST` is **omitted** from the returned object
  (the key disappears entirely; it is not replaced with a placeholder).
- **Total** — accepts any JSON value: objects, arrays, primitives, `null`.
  Non-object inputs are returned unchanged.

## Call sites

| Path                              | Where redaction is applied                         |
| --------------------------------- | --------------------------------------------------- |
| `GET /audit/org/:orgId`           | Each entry's `payload` before it enters the response |
| `GET /audit/org/:orgId/export`    | Each entry's `payload` before it is written to CSV/PDF |
| `emitAudit` (write side)          | **Never** — the stored payload keeps every field    |

## Verification

- Unit: a stored payload seeded with every deny-list key (nested) → all keys
  absent from the function's output; a payload with no deny-list keys →
  structurally identical output.
- Integration: register a user (whose `user.registered` payload may carry a
  hash), then query and export the audit log → zero deny-list field names
  appear in either result (SC-504a). For an identical filter set, the redacted
  payloads in the export equal those in the query across all pages.
