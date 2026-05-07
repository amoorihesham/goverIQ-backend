# Implementation Plan: Organizations, Roles & Members Module

**Branch**: `003-org-roles-members` | **Date**: 2026-05-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/003-org-roles-members/spec.md`

## Summary

Compose 18 Fastify route handlers across three sub-domains (org, role, member) plus
one public plugin (invitation accept/decline), one new pre-handler factory
(onboarding tier enforcement), and extensions to the existing permission guard. No
schema changes — all four tables (`organizations`, `roles`, `memberships`,
`invitations`) already exist from Phase 0. Three new error codes (`PRIVILEGE_ESCALATION`,
`ROLE_IN_USE`, `SOLE_OWNER`) are added to the shared registry. Twelve audit events
emit transactionally. The module satisfies all 15 functional requirements
(FR-201 … FR-215) and all 8 success criteria (SC-201 … SC-208) from the spec.

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js 24 LTS (unchanged)
**Primary Dependencies**: Fastify 5.8.x, Drizzle ORM, Zod 4.x, Pino (all installed).
No new runtime dependencies.
**Storage**: existing `organizations` / `roles` / `memberships` / `invitations`
Postgres tables — no migrations.
**Testing**: Vitest (unit + integration); integration test helpers at
`tests/integration/helpers/` need a `truncateOrgTables()` addition.
**Target Platform**: Linux server / Node.js 24 (containerized; stateless). Unchanged.
**Project Type**: Backend web service — modular monolith. `src/modules/org/` is
the second domain module after auth.
**Performance Goals**: All endpoints p95 < 200 ms (Constitution IV). The slowest
operations are role-creation (one membership query + one role insert + one audit
insert) and invite-acceptance (user lookup + optional user insert + membership
upsert + invitation update + audit insert + optional refresh token insert). All
fit within budget against 1,000 orgs / 10,000 members (SC-208), because every
query hits a unique index.
**Constraints**: Every state-changing handler MUST run inside `withTx` so that
`emitAudit(tx, …)` joins the same transaction (FR-215 + Constitution audit invariant).
Onboarding step advances MUST happen in the same transaction as the triggering write
(FR-204). Permission resolution MUST be per-request from the DB — no caching (FR-214).
**Scale/Scope**: 18 protected routes + 2 public routes, 1 pre-handler factory,
3 new error codes, 12 audit events, ≈ 20 new source files plus tests.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Gate Verification |
|---|---|---|
| I. Code Quality | Pass | Module split into org / role / member sub-files (routes / controller / service / repository); pure helpers (slug, invite-token, privilege) have no Fastify dependency; lint + Prettier enforced; no `any` without inline justification |
| II. Testing Standards | Pass | Unit tests for slug.ts, invite-token.ts, privilege.ts; integration tests per sub-domain (org, onboarding, role, member-invite, member-manage, sole-owner); coverage stays ≥ 80%; TDD enforced |
| III. API Design Consistency | Pass | All responses use existing envelope; all errors use codes from registry (extended with 3 new codes here); contracts authored in `contracts/` before any handler; cursor pagination consistent with Phase 0 HTTP conventions |
| IV. Performance Requirements | Pass | All queries hit unique indexes (`organizations_name_lower_idx`, `memberships_user_org_unique`, `invitations_token_hash_idx`, `roles_org_name_unique`); no N+1 patterns; invite-acceptance is fixed-shape regardless of member count |

**Pre-design Constitution Check: PASS.** No violations. Complexity Tracking section
is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-org-roles-members/
├── plan.md              # This file
├── research.md          # Phase 0 output — 9 technical decisions
├── data-model.md        # Phase 1 output — column-level mapping, state transitions, audit writes
├── quickstart.md        # Phase 1 output — end-to-end verification walkthrough
├── contracts/
│   ├── org.openapi.yaml              # 6 org endpoints
│   ├── roles.openapi.yaml            # 6 role endpoints
│   ├── members.openapi.yaml          # 5 protected member endpoints
│   ├── invitations-public.openapi.yaml  # 2 public accept/decline endpoints
│   ├── onboarding-middleware.md      # Internal contract: requireOnboardingStep
│   └── permission-guard-update.md   # Internal contract: guard extensions
└── tasks.md             # Phase 2 output (NOT created here — /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── modules/
│   └── org/                              # NEW — second domain module
│       ├── index.ts                      # Exports orgPlugin (under /api/v1) +
│       │                                 #   invitationsPublicPlugin (at root)
│       ├── org.routes.ts                 # 6 org endpoints
│       ├── org.controller.ts
│       ├── org.service.ts                # withTx + emitAudit for org ops
│       ├── org.repository.ts             # Drizzle queries on organizations
│       ├── role.routes.ts                # 6 role endpoints
│       ├── role.controller.ts
│       ├── role.service.ts               # withTx + emitAudit + onboarding advance
│       ├── role.repository.ts            # Drizzle queries on roles
│       ├── member.routes.ts              # 5 protected + 2 public invite routes
│       ├── member.controller.ts
│       ├── member.service.ts             # withTx + emitAudit + new-user creation
│       ├── member.repository.ts          # Drizzle queries on memberships + invitations
│       ├── onboarding.prehandler.ts      # requireOnboardingStep(tier) factory
│       ├── privilege.ts                  # assertNoPrivilegeEscalation() pure utility
│       ├── slug.ts                       # generateSlug() + ensureUniqueSlug()
│       ├── invite-token.ts               # generateInviteToken() + hashInviteToken()
│       └── constants.ts                  # INVITATION_TOKEN_BYTES, INVITATION_TTL_DAYS, etc.
├── shared/
│   ├── permissions/
│   │   └── guard.ts                      # ADD requireOwner(); SET request.orgMembership
│   └── errors/
│       ├── codes.ts                      # ADD PRIVILEGE_ESCALATION, ROLE_IN_USE, SOLE_OWNER
│       └── http-error.ts                 # ADD 3 factory methods
├── app.ts                                # REGISTER orgPlugin (/api/v1) +
│                                         #   invitationsPublicPlugin (root)
└── types/
    └── fastify.d.ts                      # ADD orgMembership?: { roleId, isOwner, permissions }

tests/
├── unit/
│   └── modules/org/
│       ├── slug.test.ts                  # generateSlug, ensureUniqueSlug, collision
│       ├── invite-token.test.ts          # generateInviteToken, hashInviteToken
│       └── privilege.test.ts             # assertNoPrivilegeEscalation edge cases
└── integration/
    ├── helpers/
    │   └── db.ts                         # ADD truncateOrgTables()
    └── modules/org/
        ├── org.test.ts                   # FR-201, FR-202, FR-213 (create/read/update/archive)
        ├── onboarding.test.ts            # FR-203, FR-204 (middleware tiers + step advances)
        ├── role.test.ts                  # FR-205–FR-208 (CRUD + escalation + immutability)
        ├── member-invite.test.ts         # FR-209–FR-211 (invite + accept new/existing + decline)
        ├── member-manage.test.ts         # FR-212a (list) + FR-212 (remove + role assign/revoke)
        └── sole-owner.test.ts            # FR-212 sole-owner invariant under all attack vectors
```

**Structure Decision**: Single-project modular monolith — same as Phase 0/1. The `org`
directory groups all three sub-domains to avoid cross-module import cycles (roles and
members share transaction boundaries with orgs). Two Fastify plugin exports allow
`app.ts` to handle path-prefix separation cleanly.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. This section is intentionally empty.

---

## Implementation Notes

### New Error Codes (codes.ts additions)

```ts
PRIVILEGE_ESCALATION: { code: 'PRIVILEGE_ESCALATION', httpStatus: 403,
  message: 'Privilege escalation not permitted' },
ROLE_IN_USE: { code: 'ROLE_IN_USE', httpStatus: 409,
  message: 'Role is assigned to one or more members' },
SOLE_OWNER: { code: 'SOLE_OWNER', httpStatus: 409,
  message: 'Cannot remove the sole owner of an organization' },
```

### Key Invariant Implementations

**Org creation atomicity (FR-201)**:
```ts
await withTx(async (tx) => {
  const org = await tx.insert(organizations).values({...}).returning();
  const ownerRole = await tx.insert(roles).values({ orgId: org.id, isOwner: true,
    permissions: ALL_PERMISSIONS }).returning();
  await tx.insert(memberships).values({ userId, orgId: org.id, roleId: ownerRole.id });
  await emitAudit(tx, { orgId: org.id, actorId: userId, event: 'org.created', ... });
});
```

**Onboarding step advance on first role (FR-204)**:
```ts
await withTx(async (tx) => {
  const role = await tx.insert(roles).values({...}).returning();
  const nonOwnerCount = await tx.select(...).where(and(eq(roles.orgId, orgId),
    eq(roles.isOwner, false)));
  if (nonOwnerCount === 1) { // this was the first
    await tx.update(organizations).set({ onboardingStep: 'PENDING_INVITES' })
      .where(eq(organizations.id, orgId));
  }
  await emitAudit(tx, { event: 'role.created', ... });
});
```

**Sole-owner check (FR-212)**:
```ts
// Before remove or role-revoke:
const ownerCount = await db.select(...).from(memberships)
  .innerJoin(roles, eq(memberships.roleId, roles.id))
  .where(and(eq(memberships.orgId, orgId), eq(roles.isOwner, true)));
if (ownerCount === 1 && targetMembership.role.isOwner) {
  throw AppError.create('SOLE_OWNER');
}
```

**Privilege escalation check (FR-206)**:
```ts
// src/modules/org/privilege.ts
export function assertNoPrivilegeEscalation(
  callerPermissions: PermissionKey[],
  requestedPermissions: PermissionKey[],
): void {
  const callerSet = new Set(callerPermissions);
  const violation = requestedPermissions.find((p) => !callerSet.has(p));
  if (violation) throw AppError.create('PRIVILEGE_ESCALATION');
}
// Owners bypass: service layer skips call when request.orgMembership.isOwner = true
```

**Slug generation with collision resolution (research §3)**:
```ts
// src/modules/org/slug.ts
export function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export async function ensureUniqueSlug(db, base: string): Promise<string> {
  for (let i = 0; i <= SLUG_MAX_SUFFIX_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await db.select().from(organizations)
      .where(eq(organizations.slug, candidate)).limit(1);
    if (!exists.length) return candidate;
  }
  return `${base}-${randomBytes(SLUG_FALLBACK_RANDOM_BYTES).toString('hex')}`;
}
```

**New-user invite acceptance (research §7, spec clarification Q1)**:
```ts
// if email has no account:
await withTx(async (tx) => {
  const user = await tx.insert(users).values({
    email: invitation.email,
    passwordHash: await hashPassword(body.password),
    isVerified: true,   // invite token proves email ownership
  }).returning();
  const refreshCleartext = generateRefreshTokenCleartext(user.id);
  await tx.insert(refreshTokens).values({ userId: user.id,
    tokenHash: hashRefreshToken(refreshCleartext), ... });
  await tx.insert(memberships).values({ userId: user.id, orgId, roleId: invitation.roleId });
  await tx.update(invitations).set({ status: 'ACCEPTED' });
  if (org.onboardingStep === 'PENDING_INVITES') {
    await tx.update(organizations).set({ onboardingStep: 'COMPLETE' });
  }
  await emitAudit(tx, { event: 'member.joined', ... });
  // response includes accessToken + Set-Cookie
});
```

### app.ts Registration

```ts
// Existing: auth under /auth
await fastify.register(async (instance) => {
  await instance.register(authPlugin, { prefix: '/auth' });
  await instance.register(orgPlugin, { prefix: '/api/v1' });       // NEW
}, { prefix: '' });

await fastify.register(invitationsPublicPlugin);                   // NEW — no prefix
```

### Test Helper Addition

```ts
// tests/integration/helpers/db.ts — add alongside truncateAuthTables()
export async function truncateOrgTables(): Promise<void> {
  const db = getDatabaseClient();
  await db.execute(sql`TRUNCATE organizations, roles, memberships, invitations
    RESTART IDENTITY CASCADE`);
}
```

---

## Post-Design Constitution Re-check

After generating `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`:

| Principle | Status | Notes |
|---|---|---|
| I. Code Quality | Pass | Pure helpers (slug, invite-token, privilege) have zero Fastify/DB imports; single-responsibility per file; service layer is the only place transactions begin |
| II. Testing Standards | Pass | 3 unit test files (pure helpers) + 6 integration test files covering every FR/SC; sole-owner invariant has its own dedicated test file for exhaustive coverage |
| III. API Design Consistency | Pass | 4 OpenAPI contract files + 2 internal contract docs authored before implementation; all 18 routes use existing envelope; 3 new error codes added to registry; cursor pagination consistent with Phase 0 HTTP conventions |
| IV. Performance Requirements | Pass | Every query in the hot path hits a unique index; invite-acceptance is bounded fixed-cost regardless of org size; no N+1 patterns — list endpoints use joins, not per-row queries |

**Post-design Constitution Check: PASS.** Ready for `/speckit-tasks`.
