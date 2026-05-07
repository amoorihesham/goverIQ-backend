# Tasks: Organizations, Roles & Members Module

**Input**: Design documents from `specs/003-org-roles-members/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Included — TDD is mandated by the project constitution (§II Testing Standards).
Unit tests for pure utilities are written *inside* Phase 2 immediately before their implementations.
Integration tests for each user story are written *first* inside that story's phase.

**Organization**: Tasks group by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Exact file paths are included in every description

---

## Phase 1: Setup

**Purpose**: Create directory scaffolding before any implementation begins.

- [x] T001 Create directories: `src/modules/org/`, `tests/unit/modules/org/`, `tests/integration/modules/org/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure (error codes, type augmentations, guard extension) and
pure utility modules (slug, invite-token, privilege, onboarding pre-handler) that every
user story depends on. Unit tests for pure utilities are written first (TDD).

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T002 [P] Add `PRIVILEGE_ESCALATION` (403), `ROLE_IN_USE` (409), `SOLE_OWNER` (409) entries to `src/shared/errors/codes.ts`
- [x] T003 [P] Add `privilegeEscalation()`, `roleInUse()`, `soleOwner()` factory methods to `src/shared/errors/http-error.ts`
- [x] T004 [P] Add `orgMembership?: { roleId: string | null; isOwner: boolean; permissions: string[] }` field to `FastifyRequest` in `src/types/fastify.d.ts`
- [x] T005 Extend `src/shared/permissions/guard.ts`: set `request.orgMembership` after membership resolution inside `requirePermission`, and add exported `requireOwner()` pre-handler that verifies `is_owner = true` on the caller's membership
- [x] T006 [P] Create `src/modules/org/constants.ts` declaring `INVITATION_TOKEN_BYTES = 32`, `INVITATION_TTL_DAYS = 7`, `DEFAULT_QUORUM_THRESHOLD = '0.50'`, `SLUG_MAX_SUFFIX_ATTEMPTS = 9`, `SLUG_FALLBACK_RANDOM_BYTES = 2`
- [x] T007 [P] Write unit tests in `tests/unit/modules/org/slug.test.ts` for `generateSlug` (basic slugification, special chars, leading/trailing hyphens) and `ensureUniqueSlug` (no collision → base returned, numeric suffix up to 9, random hex fallback) — **tests MUST FAIL before T008**
- [x] T008 [P] Create `src/modules/org/slug.ts` with `generateSlug(name: string): string` and `ensureUniqueSlug(db, base: string): Promise<string>` per research §3 (makes T007 pass)
- [x] T009 [P] Write unit tests in `tests/unit/modules/org/invite-token.test.ts` for `generateInviteToken` (returns 64-char lowercase hex) and `hashInviteToken` (deterministic SHA-256 hex, different input ≠ same hash) — **tests MUST FAIL before T010**
- [x] T010 [P] Create `src/modules/org/invite-token.ts` with `generateInviteToken(): string` (32 random bytes → hex) and `hashInviteToken(token: string): string` (SHA-256) per research §2 (makes T009 pass)
- [x] T011 [P] Write unit tests in `tests/unit/modules/org/privilege.test.ts` for `assertNoPrivilegeEscalation` covering: empty requested set passes, strict superset passes, exact match passes, any missing permission throws `PRIVILEGE_ESCALATION`, owner with all permissions bypasses — **tests MUST FAIL before T012**
- [x] T012 [P] Create `src/modules/org/privilege.ts` with `assertNoPrivilegeEscalation(callerPermissions: string[], requestedPermissions: string[]): void` throwing `AppError.privilegeEscalation()` on violation per research §5 (makes T011 pass)
- [x] T013 Create `src/modules/org/onboarding.prehandler.ts` with `requireOnboardingStep(tier: OnboardingTier): preHandlerHookHandler` implementing the tier-gate table from `specs/003-org-roles-members/contracts/onboarding-middleware.md` (reads orgId from params, queries org, throws NOT_FOUND / ORG_ARCHIVED / FORBIDDEN as appropriate)
- [x] T014 Add `truncateOrgTables(): Promise<void>` to `tests/integration/helpers/db.ts` running `TRUNCATE organizations, roles, memberships, invitations RESTART IDENTITY CASCADE`

**Checkpoint**: All shared infrastructure and pure utilities ready — begin user story implementation

---

## Phase 3: User Story 1 — Organization Creation with Automated Ownership (P1) 🎯 MVP

**Goal**: `POST /api/v1/orgs` atomically creates org + Owner role + creator membership.
`GET /api/v1/orgs/:orgId` reads the org. Slug is auto-derived; org name is globally unique (case-insensitive).

**Independent Test**: Authenticate as a verified user → `POST /api/v1/orgs` → verify 201 with `onboardingStep: PENDING_ROLES` and auto-derived slug → `GET /api/v1/orgs/:orgId` returns full org object → duplicate name returns 409 `DUPLICATE_ORG_NAME`.

### Tests for User Story 1 — write FIRST, must FAIL before implementation

- [x] T015 [P] [US1] Write integration tests in `tests/integration/modules/org/org.test.ts` covering: FR-201 atomic creation (happy path + rollback-injection: forced mid-tx failure leaves zero rows), FR-202 case-insensitive duplicate name rejection, GET org success, GET org 404 for unknown orgId

### Implementation for User Story 1

- [x] T016 [P] [US1] Create `src/modules/org/org.repository.ts` with `findByNameLower(db, nameLower)`, `insertOrg(tx, data)`, `insertOwnerRole(tx, orgId)`, `insertMembership(tx, userId, orgId, roleId)`, `findOrgById(db, orgId)` Drizzle queries using `organizations`, `roles`, `memberships` tables
- [x] T017 [US1] Create `src/modules/org/org.service.ts` with `createOrg(userId, body)` using `withTx` to atomically: derive slug via `ensureUniqueSlug`, insert org, insert Owner role (all 22 permissions, `isOwner: true`), insert membership, call `emitAudit(tx, { event: 'org.created', ... })`; and `getOrg(userId, orgId)` that verifies caller membership (depends on T016)
- [x] T018 [US1] Create `src/modules/org/org.controller.ts` with `createOrg` and `getOrg` request handlers that call `org.service.ts` and reply with the standard success envelope (depends on T017)
- [x] T019 [US1] Create `src/modules/org/org.routes.ts` registering `POST /api/v1/orgs` (`identityRequired`, Zod body validation) and `GET /api/v1/orgs/:orgId` (`identityRequired`, `requireOnboardingStep('always')`) wiring to `org.controller.ts` (depends on T013, T018)
- [x] T020 [US1] Create `src/modules/org/index.ts` exporting `orgPlugin` (registers `org.routes.ts` + stub imports for role and member routes) and `invitationsPublicPlugin` (stub — filled out in Phase 6) (depends on T019)
- [x] T021 [US1] Register `orgPlugin` under `/api/v1` prefix and `invitationsPublicPlugin` stub at root in `src/app.ts` (depends on T020)

**Checkpoint**: `POST /api/v1/orgs` and `GET /api/v1/orgs/:orgId` fully functional and tested

---

## Phase 4: User Story 2 — Onboarding Sequence Gating (P1)

**Goal**: Server-enforced step ordering via `requireOnboardingStep` middleware.
`GET /api/v1/orgs/:orgId/onboarding` reads current step.
`POST /api/v1/orgs/:orgId/onboarding/skip` (Owner-only) advances `PENDING_INVITES → COMPLETE`.

**Independent Test**: Create org (`PENDING_ROLES`) → attempt `PATCH /orgs/:orgId` → 403 blocked → create first role → `GET /onboarding` returns `PENDING_INVITES` → attempt list-members → 403 → `POST /onboarding/skip` → `GET /onboarding` returns `COMPLETE` → all routes now open.

### Tests for User Story 2 — write FIRST

- [x] T022 [P] [US2] Write integration tests in `tests/integration/modules/org/onboarding.test.ts` covering all 8 scenarios from `contracts/onboarding-middleware.md`: tier pass/block at each step, archived org returns `ORG_ARCHIVED`, unknown orgId returns 404

### Implementation for User Story 2

- [x] T023 [US2] Add `getOnboardingStep(userId, orgId)` and `skipOnboarding(userId, orgId)` methods to `src/modules/org/org.service.ts` (skipOnboarding advances `PENDING_INVITES → COMPLETE` in a `withTx`; throws `INVALID_STATE_TRANSITION` if step is not `PENDING_INVITES`)
- [x] T024 [US2] Add `getOnboardingStep` and `skipOnboarding` handler methods to `src/modules/org/org.controller.ts`
- [x] T025 [US2] Add `GET /api/v1/orgs/:orgId/onboarding` (`identityRequired`, `requireOnboardingStep('always')`) and `POST /api/v1/orgs/:orgId/onboarding/skip` (`identityRequired`, `requireOnboardingStep('invitation')`, `requireOwner()`) to `src/modules/org/org.routes.ts`

**Checkpoint**: Onboarding tier enforcement active on all registered routes; step transitions correct

---

## Phase 5: User Story 3 — Custom Role Management with Privilege Escalation Prevention (P1)

**Goal**: 6 role endpoints: list permissions, CRUD roles. Privilege escalation check on create/update.
Owner role is immutable. `ROLE_IN_USE` blocks delete when active memberships exist.
First non-Owner role creation advances onboarding from `PENDING_ROLES → PENDING_INVITES`.

**Independent Test**: Authenticate as Owner → `GET /roles/permissions` (22 keys) → create role with subset of own permissions (success, onboarding advances) → attempt to create role with unowned permission (`PRIVILEGE_ESCALATION`) → attempt update/delete Owner role (403) → delete non-Owner role with active member (`ROLE_IN_USE`).

### Tests for User Story 3 — write FIRST

- [x] T026 [P] [US3] Write integration tests in `tests/integration/modules/org/role.test.ts` covering FR-205 (permissions list), FR-206 (escalation check on create + update), FR-207 (Owner immutability), FR-208 (ROLE_IN_USE), FR-204 (onboarding advance on first role in same tx), SC-203

### Implementation for User Story 3

- [x] T027 [P] [US3] Create `src/modules/org/role.repository.ts` with `listRoles(db, orgId)`, `findRoleById(db, orgId, roleId)`, `insertRole(tx, data)`, `updateRole(tx, roleId, data)`, `deleteRole(tx, roleId)`, `countMembersHoldingRole(db, roleId)`, `countNonOwnerRoles(tx, orgId)` Drizzle queries
- [x] T028 [US3] Create `src/modules/org/role.service.ts` with `listPermissions()` (returns hardcoded 22-key array), `createRole(userId, orgId, body)` (privilege check via `assertNoPrivilegeEscalation` + `withTx` insert + onboarding advance if first non-Owner role + `role.created` audit), `getRole(userId, orgId, roleId)`, `updateRole(userId, orgId, roleId, body)` (Owner immutability check + escalation check + `role.updated` audit), `deleteRole(userId, orgId, roleId)` (`ROLE_IN_USE` check + `role.deleted` audit) (depends on T027)
- [x] T029 [US3] Create `src/modules/org/role.controller.ts` with `listPermissions`, `createRole`, `getRole`, `updateRole`, `deleteRole` handlers (depends on T028)
- [x] T030 [US3] Create `src/modules/org/role.routes.ts` with: `GET /orgs/:orgId/roles/permissions` (tier=`role_creation`), `POST /orgs/:orgId/roles` (tier=`role_creation`, `role:create`), `GET /orgs/:orgId/roles` (tier=`invitation`), `GET /orgs/:orgId/roles/:roleId` (tier=`invitation`), `PATCH /orgs/:orgId/roles/:roleId` (tier=`complete`, `role:update`), `DELETE /orgs/:orgId/roles/:roleId` (tier=`complete`, `role:delete`) — all with `identityRequired` + `requireOnboardingStep` + optional `requirePermission` (depends on T013, T029)
- [x] T031 [US3] Import and register role routes in `src/modules/org/index.ts` within `orgPlugin` (depends on T030)

**Checkpoint**: All 6 role endpoints functional; escalation prevention and Owner immutability enforced

---

## Phase 6: User Story 4 — Invitation-Based Member Onboarding (P1)

**Goal**: `POST /orgs/:orgId/members/invitations` sends invite email.
`POST /invitations/:token/accept` handles both new-user (inline password) and existing-user paths.
`POST /invitations/:token/decline` closes the invite. All operations transactional.

**Independent Test**: Invite fresh email → follow accept link with password → membership exists under invited role → org `onboardingStep = COMPLETE` → duplicate invite attempt returns `PENDING_INVITE_EXISTS` → decline a separate invite → no membership created.

### Tests for User Story 4 — write FIRST

- [x] T032 [P] [US4] Write integration tests in `tests/integration/modules/org/member-invite.test.ts` covering: send invite success, duplicate invite (`PENDING_INVITE_EXISTS`), Owner role invite rejection, accept (new user: membership + account + session created, rollback-injection passes SC-205), accept (existing user: membership upsert, no new account), decline (no membership), expired token rejection, already-accepted token rejection, onboarding advance on acceptance

### Implementation for User Story 4

- [x] T033 [P] [US4] Add invitation methods to `src/modules/org/member.repository.ts`: `findPendingInviteByOrgEmail(db, orgId, email)`, `insertInvitation(tx, data)`, `findInvitationByTokenHash(db, tokenHash)`, `updateInvitationStatus(tx, invitationId, status)`, `upsertMembership(tx, userId, orgId, roleId)` Drizzle queries
- [x] T034 [US4] Create `src/modules/org/member.service.ts` with `sendInvitation(userId, orgId, body)` (pending-invite check + token gen + hash store + notification dispatch + `member.invited` audit), `acceptInvitation(token, body)` branching on existing vs. new user (existing: upsert membership + `ACCEPTED` + onboarding advance + `member.joined` audit; new: `withTx` create user as `is_verified=true` + hash password + insert refresh token + upsert membership + `ACCEPTED` + onboarding advance + `member.joined` audit + return access token), `declineInvitation(token)` (`DECLINED` + `member.declined` audit) (depends on T033)
- [x] T035 [US4] Create `src/modules/org/member.controller.ts` with `sendInvitation`, `acceptInvitation`, `declineInvitation` handlers — `acceptInvitation` sets `Set-Cookie` refresh token for new-user path (depends on T034)
- [x] T036 [US4] Create `src/modules/org/member.routes.ts` with `POST /orgs/:orgId/members/invitations` (`identityRequired`, `requireOnboardingStep('invitation')`, `requirePermission('member:invite')`, Zod body validation) wiring to `member.controller.ts` (depends on T013, T035)
- [x] T037 [US4] Complete `invitationsPublicPlugin` in `src/modules/org/index.ts`: register `POST /invitations/:token/accept` and `POST /invitations/:token/decline` with no pre-handlers, wiring to `member.controller.ts` handlers (depends on T035, T036)
- [x] T038 [US4] Register `invitationsPublicPlugin` (no `/api/v1` prefix) in `src/app.ts` (depends on T037)

**Checkpoint**: Invitation flow fully functional including new-user account creation and session issuance

---

## Phase 7: User Story 5 — Member Management: Remove and Role Re-assignment (P2)

**Goal**: `GET /members` (paginated, any member), `DELETE /members/:id` (remove), `PUT /members/:id/role` (assign), `DELETE /members/:id/role` (revoke). Sole-owner invariant enforced on remove and revoke.

**Independent Test**: Two-owner org → `DELETE /members/:aliceId` (success) → `DELETE /members/:bobId` (sole owner → `SOLE_OWNER`) → `PUT /members/:id/role` with valid role (success, `member.role_assigned` audit) → `DELETE /members/:id/role` for last owner (`SOLE_OWNER`).

### Tests for User Story 5 — write FIRST

- [x] T039 [P] [US5] Write integration tests in `tests/integration/modules/org/member-manage.test.ts` covering: `GET /members` paginated response (FR-212a), remove non-owner (204 + audit), assign role (200 + audit), revoke non-owner role (204 + audit)
- [x] T040 [P] [US5] Write integration tests in `tests/integration/modules/org/sole-owner.test.ts` covering all SC-204 attack vectors: remove last owner, revoke last owner's role, assign-away sole-owner role simultaneously, verify at least one owner always remains after every operation sequence

### Implementation for User Story 5

- [x] T041 [US5] Add to `src/modules/org/member.repository.ts`: `listMembers(db, orgId, cursor, limit)` (JOIN memberships+users+roles, cursor-paginated), `deleteMembership(tx, membershipId)`, `updateMemberRole(tx, membershipId, roleId)`, `clearMemberRole(tx, membershipId)`, `countOwnersInOrg(db, orgId)` Drizzle queries
- [x] T042 [US5] Add `listMembers`, `removeMember` (sole-owner check + `member.removed` audit), `assignMemberRole` (role-in-org check + escalation check + `member.role_assigned` audit), `revokeMemberRole` (sole-owner check + `member.role_revoked` audit) methods to `src/modules/org/member.service.ts` (depends on T041)
- [x] T043 [US5] Add `listMembers`, `removeMember`, `assignMemberRole`, `revokeMemberRole` handlers to `src/modules/org/member.controller.ts` (depends on T042)
- [x] T044 [US5] Add to `src/modules/org/member.routes.ts`: `GET /orgs/:orgId/members` (tier=`complete`, identity only), `DELETE /orgs/:orgId/members/:memberId` (tier=`complete`, `member:remove`), `PUT /orgs/:orgId/members/:memberId/role` (tier=`complete`, `role:assign`), `DELETE /orgs/:orgId/members/:memberId/role` (tier=`complete`, `role:revoke`) — all `identityRequired` + `requireOnboardingStep('complete')` (depends on T013, T043); import and register member routes in `src/modules/org/index.ts`

**Checkpoint**: Full member management operational; sole-owner invariant exhaustively tested

---

## Phase 8: User Story 6 — Organization Profile Management and Archiving (P2)

**Goal**: `PATCH /api/v1/orgs/:orgId` updates name/description (Owner, `org:update`).
`DELETE /api/v1/orgs/:orgId` soft-deletes (Owner-only). Both emit audit events.

**Independent Test**: `PATCH` with new unique name (200 + `org.updated` audit) → `PATCH` with taken name (409) → `DELETE` (204, `archived_at` set) → subsequent org-scoped route returns `ORG_ARCHIVED`.

### Tests for User Story 6 — write FIRST

- [x] T045 [US6] Extend `tests/integration/modules/org/org.test.ts` with update scenarios (success, name conflict returns `DUPLICATE_ORG_NAME`) and archive scenarios (204, `archived_at` non-null, subsequent request returns `ORG_ARCHIVED`, `org.archived` audit written)

### Implementation for User Story 6

- [x] T046 [P] [US6] Add `updateOrg(tx, orgId, data)` and `archiveOrg(tx, orgId)` methods to `src/modules/org/org.repository.ts`
- [x] T047 [US6] Add `updateOrg(userId, orgId, body)` (name uniqueness re-check if name changing + `org.updated` audit inside `withTx`) and `archiveOrg(userId, orgId)` (set `archivedAt` + `org.archived` audit inside `withTx`) methods to `src/modules/org/org.service.ts` (depends on T046)
- [x] T048 [US6] Add `updateOrg` and `archiveOrg` handlers to `src/modules/org/org.controller.ts` (depends on T047)
- [x] T049 [US6] Add `PATCH /api/v1/orgs/:orgId` (`identityRequired`, `requireOnboardingStep('complete')`, `requirePermission('org:update')`) and `DELETE /api/v1/orgs/:orgId` (`identityRequired`, `requireOnboardingStep('complete')`, `requireOwner()`) to `src/modules/org/org.routes.ts` (depends on T005, T013, T048)

**Checkpoint**: Organization update and archiving complete; all 18 protected routes + 2 public routes registered

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end verification, audit integrity, type safety, and lint compliance.

- [x] T050 [P] Run `pnpm lint` and `pnpm tsc --noEmit` — fix any type errors or lint violations before final validation
- [x] T051 [P] Verify all 12 audit events appear in the correct order after running `quickstart.md` steps 1–9 end-to-end (`org.created`, `role.created`, `member.invited`, `member.joined`, `member.removed`, `member.invited`, `member.declined`, `org.archived`) per SC-207
- [x] T052 Verify rollback-injection tests pass for SC-201 (org creation), SC-205 (invite acceptance), and SC-207 (all audit writes): confirm no partial rows survive a forced mid-transaction error
- [x] T053 [P] Review list endpoints (`GET /members`, `GET /roles`) for N+1 patterns — confirm both use JOINs and hit declared indexes (`memberships_user_org_unique`, `roles_org_idx`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user stories**
- **Phase 3 (US1)**: Depends on Phase 2 — first story to implement; every other story depends on it
- **Phase 4 (US2)**: Depends on Phase 3 — onboarding integration tests need real org routes
- **Phase 5 (US3)**: Depends on Phase 3 — role routes registered via `orgPlugin`
- **Phase 6 (US4)**: Depends on Phase 5 — invitations must target valid roles
- **Phase 7 (US5)**: Depends on Phase 6 — member management requires members created via invite
- **Phase 8 (US6)**: Depends on Phase 3 — independent of US3–US5; can overlap with them after US1
- **Phase 9 (Polish)**: Depends on all user stories complete

### User Story Dependencies (summary)

```
Phase 2 (Foundational)
  └─► Phase 3 (US1)
        ├─► Phase 4 (US2)
        ├─► Phase 5 (US3) ──► Phase 6 (US4) ──► Phase 7 (US5)
        └─► Phase 8 (US6)  [independent of US3–US5]
```

### Within Each Phase

- Tests are written **FIRST** and must **FAIL** before any implementation task begins (TDD — Constitution §II)
- Repository queries are implemented before service methods (service calls repository)
- Service methods are implemented before controllers (controller calls service)
- Controllers are implemented before routes (route wires controller handler)
- Routes are registered before integration tests can pass

### Parallel Opportunities

- **Phase 2**: T002–T006 are all independent (different files) — run in parallel. Utility test+impl pairs (T007→T008, T009→T010, T011→T012) are internally sequential but independent across pairs.
- **Phase 3**: T015 (write integration tests) and T016 (repository) can start simultaneously
- **Phase 5**: T026 (write tests), T027 (role repository) — parallel start
- **Phase 6**: T032 (write tests), T033 (member.repository invitation ops) — parallel start
- **Phase 7**: T039 and T040 (two test files) — parallel start; T041 can run alongside both
- **Phase 8**: T045 (write tests), T046 (repository additions) — parallel start
- **Phase 9**: T050, T051, T053 — all parallel

---

## Parallel Example: Phase 2 (Foundational)

```
Parallel stream A: T002 (error codes) → T003 (factory methods)
Parallel stream B: T004 (type declaration)
Parallel stream C: T005 (guard extension)
Parallel stream D: T006 (constants) → T007 (slug test) → T008 (slug impl)
Parallel stream E: T009 (invite-token test) → T010 (invite-token impl)
Parallel stream F: T011 (privilege test) → T012 (privilege impl)
Sequential after all above: T013 (onboarding pre-handler) → T014 (test helper)
```

## Parallel Example: Phase 5 (US3 — Role Management)

```
# Start in parallel:
Task T026: Integration tests in tests/integration/modules/org/role.test.ts
Task T027: src/modules/org/role.repository.ts

# After T026 + T027:
Task T028: src/modules/org/role.service.ts
Task T029: src/modules/org/role.controller.ts (can start after T028)
Task T030: src/modules/org/role.routes.ts (after T029)
Task T031: Register role routes in index.ts (after T030)
```

---

## Implementation Strategy

### MVP First (P1 User Stories 1–4, Phases 1–6)

1. Phase 1: Setup
2. Phase 2: Foundational — **complete entirely before any story work**
3. Phase 3: US1 — org creation + read
4. Phase 4: US2 — onboarding gating
5. Phase 5: US3 — role management
6. Phase 6: US4 — invitation flow
7. **STOP and VALIDATE**: Run quickstart.md steps 1–5; verify all P1 acceptance scenarios

### Incremental Delivery

1. After Phase 6 (MVP): orgs can be created, onboarding enforced, roles managed, members invited
2. Phase 7 (US5): adds day-to-day membership governance (remove, role reassignment)
3. Phase 8 (US6): adds org profile update and archiving
4. Phase 9 (Polish): cross-cutting verification and lint/type cleanup

### Parallel Team Strategy (if staffed)

After Phase 3 (US1) completes:
- Dev A: Phase 4 (US2) → Phase 5 (US3) → Phase 6 (US4) → Phase 7 (US5) [sequential chain]
- Dev B: Phase 8 (US6) [independent of US3–US5 after US1 exists]

---

## Notes

- `[P]` means the task touches different files than its peers — safe to start in parallel
- `[US#]` traces each task to a specific user story for traceability and independent testability
- Tests must FAIL before implementation; passing tests before implementation indicates a bug in the test
- Commit after each phase checkpoint at minimum; after each task is also fine
- All state-changing handlers MUST use `withTx` so `emitAudit` joins the same transaction (FR-215)
- Permission resolution is per-request from DB — no caching permitted (FR-214)
- Sole-owner check queries the DB fresh inside the transaction — no cached membership state
