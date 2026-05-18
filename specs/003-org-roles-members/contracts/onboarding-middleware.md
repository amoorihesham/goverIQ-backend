# Internal Contract: Onboarding Enforcement Pre-handler

**File**: `src/modules/org/onboarding.prehandler.ts` (new)
**Used by**: every org-scoped protected route in this module.

## Function signatures

```ts
export type OnboardingTier = 'always' | 'role_creation' | 'invitation' | 'complete';

export function requireOnboardingStep(tier: OnboardingTier): preHandlerHookHandler;
```

When attached as a Fastify pre-handler, the function:

1. Reads `orgId` from `request.params`.
2. Queries `organizations` for `{ onboardingStep, archivedAt }` by `orgId`.
3. Throws `AppError.notFound()` if no org matches.
4. Throws `AppError.orgArchived()` if `archivedAt != null`.
5. Evaluates the tier gate (see table below). Throws `AppError.forbidden()` with
   a clear message if blocked.

## Tier gate logic

| `onboardingStep`  | `'always'` | `'role_creation'` | `'invitation'` | `'complete'` |
| ----------------- | ---------- | ----------------- | -------------- | ------------ |
| `PENDING_ROLES`   | ✅ pass    | ✅ pass           | ❌ block       | ❌ block     |
| `PENDING_INVITES` | ✅ pass    | ❌ block          | ✅ pass        | ❌ block     |
| `COMPLETE`        | ✅ pass    | ✅ pass           | ✅ pass        | ✅ pass      |

Rationale for `'role_creation'` blocking during `PENDING_INVITES`: role creation is
the action that _transitions_ out of `PENDING_ROLES`. Once the org is at
`PENDING_INVITES`, role creation via the onboarding path is complete. However, role
creation should still be available once `COMPLETE` (orgs can always add new roles).
Therefore `COMPLETE` passes all tiers.

## Route tier assignments

| Route                                          | Tier              |
| ---------------------------------------------- | ----------------- |
| `GET /api/v1/orgs/:orgId`                      | `'always'`        |
| `GET /api/v1/orgs/:orgId/onboarding`           | `'always'`        |
| `GET /api/v1/orgs/:orgId/roles/permissions`    | `'role_creation'` |
| `POST /api/v1/orgs/:orgId/roles`               | `'role_creation'` |
| `GET /api/v1/orgs/:orgId/roles`                | `'invitation'`    |
| `GET /api/v1/orgs/:orgId/roles/:roleId`        | `'invitation'`    |
| `POST /api/v1/orgs/:orgId/members/invitations` | `'invitation'`    |
| `POST /api/v1/orgs/:orgId/onboarding/skip`     | `'invitation'`    |
| All other protected routes                     | `'complete'`      |

## Usage example

```ts
import { identityRequired } from '@/shared/auth/identity';
import { requireOnboardingStep } from '@/modules/org/onboarding.prehandler';
import { requirePermission } from '@/shared/permissions/guard';

fastify.post(
  '/api/v1/orgs/:orgId/roles',
  {
    preHandler: [identityRequired, requireOnboardingStep('role_creation'), requirePermission('role:create')],
  },
  controller.createRole,
);
```

## Test coverage

`tests/integration/modules/org/onboarding.test.ts` must cover:

1. PENDING_ROLES → role-creation route → passes.
2. PENDING_ROLES → non-role-creation route → 403 blocked.
3. PENDING_INVITES → invitation route → passes.
4. PENDING_INVITES → role-creation route → 403 blocked.
5. PENDING_INVITES → member-management route → 403 blocked.
6. COMPLETE → all tiers pass.
7. Archived org → 409 ORG_ARCHIVED on any request.
8. Unknown orgId → 404 NOT_FOUND.
