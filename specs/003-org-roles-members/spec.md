# Feature Specification: Organizations, Roles & Members Module

**Feature Branch**: `003-org-roles-members`
**Created**: 2026-05-06
**Status**: Draft
**Input**: User description: "we want to implement the organizations, roles and members module because it's a core module in this project — Phase 2 of the implementation plan"

## Clarifications

### Session 2026-05-07

- Q: When an email with no existing account accepts an invitation, how does that new user establish credentials? → A: The invite acceptance page prompts the new user to choose a password inline; the account is created with that password in the same operation.
- Q: How is the org slug generated? → A: Auto-derived from the org name at creation time (slugified); not user-settable.
- Q: Should viewing the member list require a specific permission, or is it accessible to any authenticated org member? → A: Any authenticated org member can view the member list — no specific permission required.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Organization creation with automated ownership (Priority: P1)

A verified user creates a new organization. On creation, an Owner role (with all
permissions) and the creator's membership under that Owner role are automatically
established in the same operation — the org is never left without an owner and is
never in a partially-initialized state.

**Why this priority**: Organizations are the namespace for every downstream domain
object — meetings, votes, minutes, audit logs. Nothing else in the system can be
exercised until at least one org exists. This is the first operation every user
performs after authenticating.

**Independent Test**: Authenticate as a verified user, create an org, then fetch the
org's role list and membership list — verify the Owner role and the creator's
membership both appear without any additional setup.

**Acceptance Scenarios**:

1. **Given** a verified user with a unique org name, **When** they create an
   organization, **Then** the org is created with `onboardingStep = PENDING_ROLES`,
   an Owner role (all 22 permissions, `is_owner = true`) is inserted, and a
   membership linking the creator to the Owner role is inserted — all in one
   transaction; partial state must be impossible.
2. **Given** an org name that already exists (case-insensitive), **When** any user
   attempts to create an org with that name, **Then** the request is rejected with
   `CONFLICT` and no org, role, or membership row is created.
3. **Given** a successfully created org, **When** the creator reads the org, **Then**
   the response includes the org's `onboardingStep`, name, description, and slug.

---

### User Story 2 - Onboarding sequence gating (Priority: P1)

After creating an org the owner must create at least one custom role before inviting
members. The server enforces this step order — no route other than role-creation routes
is accessible until the org's onboarding step advances to `PENDING_INVITES`, and no
route other than invitation-related routes (plus an explicit skip) is accessible until
the step advances to `COMPLETE`.

**Why this priority**: Without server-enforced onboarding the system reaches an
inconsistent state: members invited into an org with no non-Owner roles have no role to
hold. Onboarding gating prevents this class of state corruption entirely and is the
precondition for everything in User Stories 3–7.

**Independent Test**: Create an org, then attempt any non-role-creation org route (e.g.
update org, invite member) — verify all are blocked. Create the first custom role —
verify the step advances. Then attempt any non-invitation route — verify blocked. Accept
an invite or call the skip route — verify all routes open.

**Acceptance Scenarios**:

1. **Given** an org with `onboardingStep = PENDING_ROLES`, **When** a caller attempts
   any route except role-creation routes, **Then** the request is blocked with a clear
   indication that onboarding is incomplete.
2. **Given** an org with `onboardingStep = PENDING_ROLES`, **When** the first custom
   (non-Owner) role is created, **Then** `onboardingStep` advances to
   `PENDING_INVITES` within the same transaction as the role insert.
3. **Given** an org with `onboardingStep = PENDING_INVITES`, **When** a caller
   attempts any route except invitation and skip routes, **Then** the request is
   blocked.
4. **Given** an org with `onboardingStep = PENDING_INVITES`, **When** an invited
   member accepts their invitation OR the Owner explicitly skips, **Then**
   `onboardingStep` advances to `COMPLETE` in the same transaction.
5. **Given** an org with `onboardingStep = COMPLETE`, **When** any protected route is
   called with valid credentials and permissions, **Then** the request proceeds
   normally.

---

### User Story 3 - Custom role management with privilege escalation prevention (Priority: P1)

An Owner or member with role-management permissions creates roles, assigns a subset of
the system's 22 fixed permissions, and later updates or deletes them. A member with
`role:create` cannot grant to a new role any permission they do not themselves hold —
preventing privilege escalation.

**Why this priority**: Roles are the permission boundary for every protected operation.
Without custom roles, no non-owner member can be given any capability. The escalation
prevention is foundational to the security model — it must ship with role creation, not
as a hardening step.

**Independent Test**: Authenticate as a member with a limited permission set, attempt
to create a role containing a permission they do not hold — verify rejection. Create a
role with only permissions they hold — verify success. Attempt to update the Owner role
— verify blocked.

**Acceptance Scenarios**:

1. **Given** a member with `role:create`, **When** they create a role with permissions
   that are a strict subset of their own permission set, **Then** the role is created
   and the response includes all assigned permissions.
2. **Given** a member with `role:create`, **When** they include any permission they do
   not themselves hold, **Then** the request is rejected with `PRIVILEGE_ESCALATION`.
3. **Given** any caller, **When** they attempt to update or delete the Owner role
   (`is_owner = true`), **Then** the request is rejected regardless of permissions.
4. **Given** a role with active members, **When** any caller attempts to delete it,
   **Then** the request is rejected with `ROLE_IN_USE`.
5. **Given** a role with no active members, **When** a member with `role:delete`
   deletes it, **Then** the role is removed and a `role.deleted` audit entry is
   written.
6. **Given** a role update that changes permissions, **When** it completes, **Then**
   the new permission set takes effect immediately for every member holding that role —
   no cache invalidation step is needed because permissions are resolved per-request.

---

### User Story 4 - Invitation-based member onboarding (Priority: P1)

An authorized member invites an external email to join the org in a specific non-Owner
role. The invitee receives a link; clicking accept creates their membership (and their
user account if they have none). Clicking decline marks the invitation closed.

**Why this priority**: This is the only path by which new members join an org. Without
it the org remains a single-user system. The invitation model is also the trigger for
the final onboarding step, making it a prerequisite for using the application at all.

**Independent Test**: Invite a fresh email, follow the accept link, verify a membership
exists for that email under the invited role, and verify the org's onboarding step
advanced to `COMPLETE` if it was still `PENDING_INVITES`.

**Acceptance Scenarios**:

1. **Given** a member with `member:invite`, **When** they send an invitation to an
   email that has no pending invite in this org and the target role is a valid non-Owner
   org role, **Then** an invitation record is created and an email notification is
   dispatched with accept and decline links.
2. **Given** a pending invitation for an email with no existing account, **When** the
   invitee follows the accept link before expiry and submits a chosen password inline,
   **Then** a user account is created with that password, a membership is created under
   the invited role, invitation `status = ACCEPTED`, and if the org was
   `PENDING_INVITES` the step advances to `COMPLETE` — all in one operation.
   2a. **Given** a pending invitation for an email that already has an account, **When**
   the invitee follows the accept link before expiry, **Then** a membership is created
   (no new user account is created, no password prompt is shown), invitation
   `status = ACCEPTED`, and onboarding advances if applicable.
3. **Given** a pending invitation, **When** the invitee follows the decline link,
   **Then** invitation `status = DECLINED` and no membership is created.
4. **Given** a pending invite for the same email and org already exists, **When**
   another invite attempt is made, **Then** the request is rejected with
   `PENDING_INVITE_EXISTS`.
5. **Given** an invitation token for an invite that has expired, **When** the accept
   link is followed, **Then** the request is rejected and no membership is created.
6. **Given** a member with `member:invite` attempting to invite to the Owner role,
   **Then** the request is rejected — membership under the Owner role cannot be granted
   via invitation.

---

### User Story 5 - Member management: remove and role re-assignment (Priority: P2)

An authorized member removes other members from the org or changes their role. The
org's single-owner invariant is enforced at all times: the last Owner cannot be removed
or have their role revoked.

**Why this priority**: Day-to-day org governance depends on the ability to adjust
membership. The sole-owner guard prevents an accidental or malicious org lockout and
is a non-negotiable system invariant.

**Independent Test**: Create a two-member org where both have Owner role. Remove one
Owner — verify success. Attempt to remove the remaining Owner — verify `SOLE_OWNER`
rejection. Assign a different role to a non-owner member — verify the change is
reflected immediately.

**Acceptance Scenarios**:

1. **Given** a member with `member:remove`, **When** they remove a non-Owner member,
   **Then** the membership row is deleted and a `member.removed` audit entry is written.
2. **Given** the last remaining Owner in an org, **When** any caller attempts to remove
   them or revoke their role, **Then** the request is rejected with `SOLE_OWNER`.
3. **Given** a member with `role:assign`, **When** they assign a role to a member
   (with privilege escalation check passing), **Then** the membership's role is updated
   and a `member.role_assigned` audit entry is written.
4. **Given** a member with `role:revoke`, **When** they revoke a role from a member
   whose role is not `is_owner = true`, **Then** the membership's role is set to null
   and a `member.role_revoked` audit entry is written.

---

### User Story 6 - Organization profile management and archiving (Priority: P2)

An org Owner can update the org's profile (name, description) and archive the org when
it is no longer needed. Archiving is a soft-delete — data is preserved with an
`archived_at` timestamp; no physical deletion occurs.

**Why this priority**: Profile updates are routine; archiving is the controlled
end-of-life path. Both are restricted to the Owner to prevent unauthorized
org-wide changes.

**Independent Test**: Update the org name (verify uniqueness is re-checked), then
archive the org (verify a 204 response and the `archived_at` field is set), then
verify the org is excluded from normal listing but is still retrievable.

**Acceptance Scenarios**:

1. **Given** an Owner with `org:update`, **When** they update the org name to one that
   is not already taken (case-insensitive), **Then** the org is updated and an
   `org.updated` audit entry is written.
2. **Given** an Owner with `org:update`, **When** they attempt to rename the org to a
   name already used by another org (case-insensitive), **Then** the request is
   rejected with `CONFLICT`.
3. **Given** an Owner with `org:archive`, **When** they archive the org, **Then**
   `archived_at` is set, the org is excluded from normal queries, and an `org.archived`
   audit entry is written. No data is destroyed.

---

### Edge Cases

- Two users simultaneously attempting to create orgs with the same name — exactly one
  succeeds; the other receives `CONFLICT`. No partial state is left behind.
- A member inviting themselves — allowed if they hold `member:invite` and are not
  already a member (effectively a no-op invite, but valid).
- A role update (permission change) that happens while a request using the old
  permissions is in flight — the in-flight request sees the old permissions
  (snapshot at request start); the next request sees the new permissions.
- An invite token presented after the invitation has already been accepted — the token
  hash still matches but `status != PENDING`; the request must be rejected cleanly.
- An invite email that belongs to an existing user who is already a member of the org —
  the accept path must detect the existing membership and either update it to the
  invited role or reject (treat as upsert per the implementation plan).
- Simultaneous duplicate invite submissions from two separate callers — exactly one
  lands; the other receives `PENDING_INVITE_EXISTS`.
- Creating the first non-Owner role in an org that already has the onboarding step at
  `PENDING_INVITES` or `COMPLETE` — the step is not regressed; the role is created
  normally.
- Attempting to advance onboarding by deleting the only non-Owner role (leaving zero
  custom roles) should not revert `onboardingStep` — steps never go backwards.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-201**: System MUST allow a verified and authenticated user to create an
  organization. Organization creation MUST atomically: create the org record with
  `onboardingStep = PENDING_ROLES`, create an Owner role (`is_owner = true`, all
  22 system permissions), create a membership linking the creator to the Owner role,
  and emit an `org.created` audit entry — all in a single database transaction.
  If any step fails, the entire transaction MUST roll back with no partial state.

- **FR-202**: Organization names MUST be globally unique in a case-insensitive manner.
  Any attempt to create or rename an org to a name already in use MUST be rejected
  with `CONFLICT`. The uniqueness check MUST be part of the same transaction as the
  write to prevent race conditions. The org slug MUST be auto-derived from the name
  at creation time (e.g. `"My Org"` → `"my-org"`) and is not user-settable; slug
  uniqueness MUST also be enforced, with collision resolution (suffix appending)
  handled server-side so the caller never needs to supply or retry a slug.

- **FR-203**: System MUST expose an onboarding-enforcement middleware that runs on
  every non-auth, non-public protected route after identity validation. The middleware
  MUST load the target org's current `onboardingStep` and enforce:
  - `PENDING_ROLES`: only role-creation routes pass; all others are blocked
  - `PENDING_INVITES`: invitation routes and the explicit skip route pass; others
    are blocked
  - `COMPLETE`: all routes pass
    Clients MUST NOT be able to bypass a step by navigating around it.

- **FR-204**: `onboardingStep` MUST advance from `PENDING_ROLES` to `PENDING_INVITES`
  when the first non-Owner custom role is created, inside the same transaction as the
  role insert. `onboardingStep` MUST advance from `PENDING_INVITES` to `COMPLETE`
  when an invitation is accepted or the Owner explicitly skips, inside the same
  transaction. Steps MUST NOT move backwards under any circumstances.

- **FR-205**: System MUST expose the complete set of 22 system permission keys as a
  read-only endpoint. The permission set is fixed at startup; no org may add or remove
  entries. Callers need this list to build role-creation UIs.

- **FR-206**: System MUST enforce privilege escalation prevention on role creation and
  role update. A caller's permissions MUST be a superset of the permissions they attempt
  to assign to a role. If any permission in the requested set is not held by the caller,
  the request MUST be rejected with `PRIVILEGE_ESCALATION`.

- **FR-207**: The Owner role (`is_owner = true`) MUST be immutable. Any attempt to
  update or delete the Owner role MUST be rejected regardless of the caller's
  permissions.

- **FR-208**: Before deleting a role, system MUST verify no active memberships hold
  that role. If any exist, the request MUST be rejected with `ROLE_IN_USE`.

- **FR-209**: Invitation MUST be scoped to an existing, non-Owner org role. System MUST
  reject invitations targeting the Owner role. If no custom role exists yet (org still
  in `PENDING_ROLES`), the invitation path is unreachable due to onboarding gating.

- **FR-210**: There MUST be at most one pending invitation per (org, email) pair at any
  time. A second invitation attempt for the same email while a `PENDING` invite
  exists MUST be rejected with `PENDING_INVITE_EXISTS`.

- **FR-211**: On invitation acceptance, system MUST behave differently based on whether
  the invitee's email belongs to an existing account:
  - **Existing account**: look up the user by email, upsert the membership under the
    invited role, set invitation `status = ACCEPTED`, and advance onboarding if
    applicable — all in a single transaction.
  - **No existing account**: the accept endpoint MUST collect a password from the
    invitee inline (on the same acceptance page/request). System MUST create the user
    record with the provided password hash, upsert the membership, set invitation
    `status = ACCEPTED`, and advance onboarding if applicable — all in a single
    transaction. The password MUST meet the same minimum length policy as registration
    (12 characters). The new user is created in a verified state (the invite token
    serves as email proof).
    The accept and decline links MUST use an opaque token; the raw token is placed in the
    URL and matched against the stored hash.

- **FR-212**: System MUST enforce the single-owner invariant: the last member with an
  Owner role (`is_owner = true`) MUST NOT be removable or have their role revoked.
  Any such attempt MUST be rejected with `SOLE_OWNER`.

- **FR-212a**: The paginated member list MUST be accessible to any authenticated member
  of the org — no specific permission is required beyond membership. This is
  consistent with how org profile and role list reads work. Each entry MUST include
  the member's identity, role name, and join date.

- **FR-213**: Archiving an organization MUST be a soft-delete: `archived_at` is set to
  the current timestamp, the org is excluded from normal queries, and no row is
  physically deleted. The operation MUST emit an `org.archived` audit entry.

- **FR-214**: Permission resolution for every protected request MUST happen per-request
  from the database. No caching of role permissions is permitted. A permission change
  on a role MUST take effect on the very next request after the change is committed.

- **FR-215**: System MUST emit audit log entries for all 12 governance events:
  `org.created`, `org.updated`, `org.archived`, `role.created`, `role.updated`,
  `role.deleted`, `member.invited`, `member.joined`, `member.declined`,
  `member.removed`, `member.role_assigned`, `member.role_revoked`. Each entry MUST
  be written inside the same transaction as its originating write using the shared
  audit emitter. No audit entry may outlive a rolled-back transaction.

### Key Entities

- **Organization**: The top-level governance namespace. Holds a globally unique,
  case-insensitive name, a slug (auto-derived from the name at creation time, not
  user-settable), optional description, quorum threshold for votes, current onboarding
  step, and optional `archived_at` timestamp.

- **Role**: A named, org-scoped collection of permission keys drawn from the 22-key
  system permission set. Carries an `is_owner` flag. The Owner role is auto-created
  with every org and is immutable.

- **Membership**: Links a user to an org under a specific role. Unique per
  (user, org) pair. Holds the join timestamp.

- **Invitation**: A pending, accepted, or declined invitation record scoped to an org
  and an email. Carries the target role, an opaque hashed token, expiry, and status
  (`PENDING` / `ACCEPTED` / `DECLINED` / `EXPIRED`).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-201**: Org creation, including Owner role insert and membership insert, completes
  as a single atomic operation — 100% of test scenarios that inject a forced mid-transaction
  failure leave zero org, role, or membership rows behind.

- **SC-202**: 100% of test scenarios that attempt to bypass an incomplete onboarding
  step are blocked — no combination of request ordering or route manipulation lets a
  caller skip `PENDING_ROLES` or `PENDING_INVITES`.

- **SC-203**: 100% of privilege-escalation attempts — where a caller tries to assign
  a permission they do not hold — are rejected with `PRIVILEGE_ESCALATION` before
  any write occurs.

- **SC-204**: The sole-owner invariant holds under all tested conditions: no sequence
  of remove or revoke operations can leave an org without at least one Owner.

- **SC-205**: Invitation acceptance and the resulting membership upsert complete in a
  single transaction — a forced rollback after the membership insert leaves zero
  accepted-invite or membership rows.

- **SC-206**: Permission changes on a role take effect on the immediately following
  request — verified by a test sequence that changes permissions and fires the next
  request within the same test run without any explicit cache invalidation step.

- **SC-207**: All 12 audit events are present in the log after exercising each
  governance flow end-to-end, and each was written in the same transaction as its
  originating write (verified by rollback injection).

- **SC-208**: All protected org/role/member endpoints respond within 200 ms at p95
  against a database holding at least 1,000 organizations and 10,000 members,
  matching the platform-wide latency budget.

## Assumptions

- The full schema (all 17 tables including `organizations`, `roles`, `memberships`,
  and `invitations`) was delivered in Phase 0 and is available without modification.
  This feature does not introduce new tables or alter existing columns.
- The identity pre-handler from Phase 1 is available and will be reused on all
  protected routes in this module.
- The shared audit emitter, notification service, and permission guard from Phase 0
  are available and will be reused without modification.
- Quorum threshold (used during vote tallying in Phase 4) is stored on the org at
  creation time. A reasonable default value will be chosen during planning; the exact
  default is an implementation detail outside the scope of this spec.
- Invitation expiry duration and the exact format of accept/decline URLs are
  implementation details to be decided during planning.
- `logoUrl` is accepted on org creation as an optional field but its validation rules
  (format, size, hosting) are out of scope for this feature.
- The explicit "skip invitations" route (advancing `PENDING_INVITES → COMPLETE` without
  accepting an invite) is in scope as specified in the implementation plan; its exact
  HTTP path is an implementation detail.
- New users created via invitation acceptance are prompted to set a password inline
  on the acceptance page; the invite token serves as email proof so the new account
  is created in a verified state. The same 12-character minimum length policy
  from Phase 1 applies.
- Pagination for member and role list endpoints uses cursor-based pagination consistent
  with the platform HTTP conventions from Phase 0 (default 20, max 100 per page).
- Rate limiting for invitation-related endpoints is out of scope for this feature and
  is delivered as part of the Phase 5 security-hardening pass.
