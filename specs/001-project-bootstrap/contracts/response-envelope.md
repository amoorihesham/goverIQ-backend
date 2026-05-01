# Contract: Response Envelope (FR-003)

All API responses — every endpoint, every error, every domain — MUST conform to one of
the two shapes below. No endpoint may deviate.

## Success

```json
{
  "success": true,
  "data": { /* endpoint-specific payload */ }
}
```

- `success` is the literal boolean `true`.
- `data` is an object. For list endpoints with pagination, `data` includes a
  `nextCursor` field (string or null).
- HTTP status code is in the 2xx range (typically 200, 201, or 204).
- For 204 No Content, the body is omitted entirely (no envelope).

## Error

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable description of the failure.",
    "statusCode": 422
  }
}
```

- `success` is the literal boolean `false`.
- `error.code` is one of the entries in [error-codes.md](./error-codes.md). No ad-hoc
  codes permitted.
- `error.message` is a single sentence. No stack traces or internal identifiers.
- `error.statusCode` mirrors the HTTP status code on the response.
- HTTP status code matches `error.statusCode`.

## Helper Contract

The `src/shared/errors/envelope.ts` module exports:

```ts
export function ok<T>(data: T): { success: true; data: T };
export function fail(code: ErrorCode, message: string, statusCode: number): { success: false; error: { code, message, statusCode } };
```

All Fastify handlers route through these helpers (or throw `HttpError` instances which
the global error handler converts to the envelope).

## Pagination Envelope (cursor-based)

For paginated endpoints (Phase 2+):

```json
{
  "success": true,
  "data": {
    "items": [ /* ... */ ],
    "nextCursor": "<opaque-token-or-null>"
  }
}
```

- `nextCursor` is `null` when no further pages exist.
- The cursor token is opaque to clients; servers MUST validate it before use.

## Examples

**201 Create**:
```json
{ "success": true, "data": { "id": "5e0e…", "name": "Acme Inc." } }
```

**404 Not Found**:
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Organization not found.", "statusCode": 404 } }
```

**422 State machine violation**:
```json
{ "success": false, "error": { "code": "INVALID_STATE_TRANSITION", "message": "Cannot transition meeting from DRAFT directly to COMPLETED.", "statusCode": 422 } }
```
