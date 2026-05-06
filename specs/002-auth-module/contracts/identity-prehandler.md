# Internal Contract: `identityRequired` Pre-Handler

**File**: [`src/shared/auth/identity.ts`](../../../src/shared/auth/identity.ts) (new)
**Used by**: every protected route in this module's siblings (Phase 2 onward).
The auth module's own routes do **not** use this pre-handler — they are public
entry points by definition.

## Function signature

```ts
import type { preHandlerHookHandler } from 'fastify';

export const identityRequired: preHandlerHookHandler;
```

When attached as a Fastify pre-handler, the function:

1. Reads `request.headers.authorization`.
2. Validates it starts with `Bearer `.
3. Calls the existing `verifyAccessToken(token)` from
   [`src/shared/auth/jwt.ts`](../../../src/shared/auth/jwt.ts).
4. Sets `request.user = { userId: payload.sub, email: payload.email }`.

## Type augmentation

Adds the following declaration to
[`src/types/fastify.d.ts`](../../../src/types/fastify.d.ts):

```ts
declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; email: string };
  }
}
```

After `identityRequired` resolves, downstream handlers may safely read
`request.user!.userId` (the pre-handler guarantees it).

## Error mapping (FR-111)

| Condition                                               | Throws                                | Error code      | HTTP |
| ------------------------------------------------------- | ------------------------------------- | --------------- | ---- |
| `Authorization` header missing                          | `AppError.unauthorized()`             | `UNAUTHORIZED`  | 401  |
| `Authorization` header does not start with `Bearer `    | `AppError.unauthorized()`             | `UNAUTHORIZED`  | 401  |
| Token signature invalid / claims malformed              | `AppError.invalidToken()` (via `verifyAccessToken`) | `INVALID_TOKEN` | 401  |
| Token expired                                           | `AppError.tokenExpired()` (via `verifyAccessToken`) | `TOKEN_EXPIRED` | 401  |

The global `createErrorHandler` in
[`src/shared/errors/envelope.ts`](../../../src/shared/errors/envelope.ts) converts
any thrown `AppError` into the standard `{ success: false, error }` envelope.

## Usage example (Phase 2+)

```ts
import { identityRequired } from '@/shared/auth/identity';

fastify.get('/api/v1/orgs/:orgId', {
  preHandler: [identityRequired],
}, async (request) => {
  const { userId, email } = request.user!;
  // ... domain logic ...
});
```

## Test coverage (FR-111 / verification)

[`tests/integration/modules/auth/identity.test.ts`](../../../tests/integration/modules/auth/identity.test.ts)
must cover:

1. Missing `Authorization` header → 401 / `UNAUTHORIZED`.
2. Malformed header (no `Bearer ` prefix) → 401 / `UNAUTHORIZED`.
3. Tampered JWT (wrong signature) → 401 / `INVALID_TOKEN`.
4. Expired JWT (`exp` in the past) → 401 / `TOKEN_EXPIRED`.
5. Valid JWT → handler runs and sees `request.user.userId === payload.sub`.

## What this contract intentionally does NOT do

- **No org / role / permission resolution** — that lives in Phase 2's permission
  guard (`src/shared/permissions/guard.ts`). The access JWT carries identity only.
- **No refresh-token handling** — refresh is a dedicated route, not a pre-handler.
- **No rate-limiting** — Phase 5.
