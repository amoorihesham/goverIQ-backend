# Internal Contract: Permission Guard Updates (Phase 2)

**File**: `src/shared/permissions/guard.ts` (existing — extended)
**File**: `src/types/fastify.d.ts` (existing — extended)

## New: `request.orgMembership` augmentation

Extend `src/types/fastify.d.ts`:

```ts
declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; email: string };
    orgMembership?: {
      roleId: string | null;
      isOwner: boolean;
      permissions: string[];
    };
  }
}
```

`requirePermission` is updated to set `request.orgMembership` after resolving
membership, so service-layer code can read the caller's permissions without an
additional DB round-trip (needed for the privilege escalation check).

## New: `requireOwner` export

```ts
export function requireOwner(): preHandlerHookHandler;
```

When attached as a Fastify pre-handler:

1. Reads `orgId` from `request.params`.
2. Verifies access token (re-uses the existing JWT verification path).
3. Queries `memberships + roles` for the caller's membership in the org.
4. If `isOwner = false` → throws `AppError.forbidden('Owner required')`.
5. Sets `request.orgMembership` (same shape as in `requirePermission`).

Used for: `DELETE /api/v1/orgs/:orgId` (archive) and
`POST /api/v1/orgs/:orgId/onboarding/skip`.

## Updated pre-handler chain for each route category

| Category | Pre-handler array |
|---|---|
| Identity only (tier=always) | `[identityRequired, requireOnboardingStep('always')]` |
| Identity + permission | `[identityRequired, requireOnboardingStep(tier), requirePermission(perm)]` |
| Owner only | `[identityRequired, requireOnboardingStep(tier), requireOwner()]` |
| Public (invite accept/decline) | `[]` (no pre-handlers) |

## What does NOT change

- `identityRequired` is unchanged.
- The existing `requirePermission` function signature is unchanged; the
  `request.orgMembership` side-effect is additive.
- No caching of any resolved membership or permission data (Constitution II + FR-214).
