# Phase 0 Research: Organizations, Roles & Members Module

**Feature**: 003-org-roles-members
**Date**: 2026-05-07

This document resolves the open technical decisions for the org/roles/members module.
Each section follows the **Decision / Rationale / Alternatives** format. Numeric
constants live in `src/modules/org/constants.ts`.

---

## 1. Module File Layout

**Decision**: One `src/modules/org/` directory with separate file triplets for each
sub-domain (org, role, member): `<sub>.routes.ts` / `<sub>.controller.ts` /
`<sub>.service.ts` / `<sub>.repository.ts`. A single `index.ts` exports two Fastify
plugins: `orgPlugin` (registered under `/api/v1`) and `invitationsPublicPlugin`
(registered at root, no prefix) for the two public accept/decline routes.

**Rationale**: Mirrors the Phase 1 auth module layout (routes / controller / service /
repository per concern). Keeping org, role, and member in one directory avoids
cross-module import cycles while maintaining clear internal separation. Two plugin
exports let `app.ts` register protected routes under `/api/v1` and public routes at
`/invitations` without duplicating Fastify plugin wiring.

**Alternatives considered**:

- **Three separate module directories** (`src/modules/org/`, `src/modules/role/`,
  `src/modules/member/`) — stronger isolation, but roles and members have tight
  coupling to orgs (shared transaction boundaries, onboarding step writes); splitting
  them across directories forces unnatural cross-module imports.
- **Single flat file** — no separation of concerns; ruled out immediately.

---

## 2. Invitation Token Format & TTL

**Decision**: Invitation token cleartext = 32 random bytes encoded as 64-char
lowercase hex. The raw hex string is embedded in the accept/decline URL.
Storage: `SHA-256(cleartext)` in `invitations.token_hash`. TTL: **7 days** from
creation, stored in `invitations.expires_at`. Constants in `constants.ts`:
`INVITATION_TOKEN_BYTES = 32`, `INVITATION_TTL_DAYS = 7`.

**Rationale**: Identical pattern to the refresh-token design in Phase 1 (research.md §1
of 002-auth-module), which the team already reviewed and approved. 32 random bytes
(256 bits) makes brute-force impossible. SHA-256 without salt is acceptable here
because the token is single-use, bound to one invite record, and expires within 7 days.
Seven-day TTL is the governance-platform standard — long enough for the invitee to act
on a busy week, short enough to keep the invite list clean.

**Alternatives considered**:

- **JWT as invite token** — adds signing infrastructure, larger URL, requires a
  blocklist or expiry check anyway; no advantage over opaque token.
- **14-day TTL** — more time for invitees but invitations represent org membership
  permissions; the shorter window reduces the blast radius of a leaked token.

---

## 3. Slug Generation & Collision Resolution

**Decision**: Slug auto-derived from org name at creation time via:
1. Lowercase the name.
2. Replace any run of non-alphanumeric characters with a single hyphen.
3. Strip leading and trailing hyphens.

Example: `"My Org!"` → `"my-org"`.

Collision resolution (slug not globally unique): append numeric suffix `"my-org-2"`,
`"my-org-3"`, …, `"my-org-9"`. After 9 attempts, fall back to `"my-org-<4-hex-chars>"`
(random). The slug is immutable after creation — renaming the org does NOT update the
slug (org names and slugs diverge intentionally once in use in external links).

**Rationale**: Keeps the creation API simple (no slug field in the request body, per
spec clarification Q2). Numeric suffix is the universal convention. Immutability after
creation prevents breaking external bookmarks.

**Alternatives considered**:

- **Slug updated on name change** — breaks any external link that includes the slug.
  Rejected for governance platforms where audit links are long-lived.
- **UUID-based slug fallback** — too ugly for URLs; 4 hex chars (65,536 combinations)
  is sufficient given the uniqueness window.

---

## 4. Onboarding Enforcement Pre-handler Design

**Decision**: Route-tier annotation pattern. Each route declares its required
`onboardingTier` as a Fastify route option. A pre-handler factory
`requireOnboardingStep(tier)` reads the org's current `onboardingStep` (one DB query,
no cache) and blocks mismatches.

Four tiers:

| Tier | Allowed when step is |
|---|---|
| `'always'` | PENDING_ROLES, PENDING_INVITES, COMPLETE |
| `'role_creation'` | PENDING_ROLES, COMPLETE |
| `'invitation'` | PENDING_INVITES, COMPLETE |
| `'complete'` | COMPLETE only (default) |

If the org has `archived_at != null`, the middleware throws `ORG_ARCHIVED` (already in
error codes registry).

**Rationale**: Pre-handler factory is the same pattern as `requirePermission(perm)`;
it composes cleanly in `preHandler` arrays. Tier annotation at the route level makes
the access policy readable without hunting through middleware logic.

**Alternatives considered**:

- **Path-matching in a single middleware** — fragile (URL changes break logic) and
  hard to test without real routes registered.
- **Feature flags on the org** — defeats the purpose; onboarding state IS the flag.

---

## 5. Privilege Escalation Check

**Decision**: Pure utility function `assertNoPrivilegeEscalation(callerPermissions,
requestedPermissions)` in `src/modules/org/privilege.ts`. Throws
`AppError.privilegeEscalation()` if any requested permission is absent from the
caller's set. Owners bypass this by passing `ALL_PERMISSIONS` as their permission set
(since `requirePermission` already resolves them as owner and the service layer can
skip the check via `isOwner` flag propagated in `request.orgMembership`).

The `requirePermission` guard in `src/shared/permissions/guard.ts` is extended to set
`request.orgMembership = { roleId, isOwner, permissions }` after resolving membership,
so the service layer can read it without an additional DB round-trip.

**Rationale**: The check is a pure function (two arrays in, bool out) and belongs in
the module rather than the shared layer (only org/role operations need it). Setting
`request.orgMembership` in the guard avoids a second DB query in the service layer.

**Alternatives considered**:

- **Check in the pre-handler** — pre-handlers don't have access to the request body
  (it hasn't been parsed when pre-handlers run in Fastify's default lifecycle for
  body-decoded routes). The requested permissions come from the request body.
  Therefore the check MUST be in the service layer.
- **Re-query in the service layer** — works but doubles DB round-trips for every
  role-create / role-update request.

---

## 6. New Error Codes

**Decision**: Add three codes to `src/shared/errors/codes.ts` and three factory
methods to `src/shared/errors/http-error.ts`:

| Code | HTTP | Message |
|---|---|---|
| `PRIVILEGE_ESCALATION` | 403 | Privilege escalation not permitted |
| `ROLE_IN_USE` | 409 | Role is assigned to one or more members |
| `SOLE_OWNER` | 409 | Cannot remove the sole owner of an organization |

**Rationale**: All three are domain-specific codes called out in the master
implementation plan. Using `FORBIDDEN` or `CONFLICT` with custom messages would work
but loses the machine-readable error code that clients need for conditional UX.

---

## 7. New User Creation via Invitation Acceptance (Spec Clarification Q1)

**Decision**: The `POST /invitations/:token/accept` endpoint accepts an optional
`password` field. Validation rules:

- If the invitee email already has a user account → `password` field MUST be absent
  (or ignored — not validated). The existing user is used.
- If the invitee email has no account → `password` field is REQUIRED, minimum 12
  characters (same policy as Phase 1 registration). The new user is created as
  `is_verified = true` (the invite token itself proves email ownership). A refresh
  token is issued to start a session immediately after acceptance.

Both paths upsert the membership and advance onboarding if applicable — all in one
transaction.

**Rationale**: Per spec clarification Q1 (session 2026-05-07). Inline password setup
is the lowest-friction path for new users. Creating the user as `is_verified = true`
is correct because the invitation token was sent to that specific email address.

**Alternatives considered**:

- **Separate "set-password" endpoint after acceptance** — adds a second step and a
  state where the user exists but is locked out. Rejected.
- **Passwordless via magic link** — adds a new auth flow outside this phase's scope.

---

## 8. Onboarding Skip Endpoint

**Decision**: `POST /api/v1/orgs/:orgId/onboarding/skip` — Owner-only, advances
`PENDING_INVITES → COMPLETE`. Returns 204. This is a 6th org endpoint (the master
plan's "5 endpoints" count is an approximation; the skip route is implied by the
onboarding enforcement spec). The route has `tier: 'invitation'` (it's accessible
during `PENDING_INVITES` — that's its entire purpose) and is Owner-only enforced in
the service layer.

**Rationale**: The spec explicitly requires this path to exist ("invite routes and the
skip-step route pass through"). Making it a separate endpoint (rather than a field on
PATCH /orgs/:orgId) gives it a clear intent and makes the onboarding-tier annotation
unambiguous.

---

## 9. `requirePermission` Guard Enhancement

**Decision**: Extend `src/shared/permissions/guard.ts` → after successfully resolving
membership, set `request.orgMembership = { roleId, isOwner, permissions }`. Add a new
export `requireOwner` (pre-handler) that verifies the caller is an org Owner
(`is_owner = true`) without requiring a specific permission.

`requireOwner` is used for the archive endpoint (`DELETE /api/v1/orgs/:orgId`) as the
implementation plan specifies "Owner only" (not permission-based).

---

## Numeric Constants Summary

All values live in `src/modules/org/constants.ts`:

| Constant | Value | Source |
|---|---|---|
| `INVITATION_TOKEN_BYTES` | `32` | research §2 |
| `INVITATION_TTL_DAYS` | `7` | research §2 |
| `DEFAULT_QUORUM_THRESHOLD` | `'0.50'` | schema default |
| `SLUG_MAX_SUFFIX_ATTEMPTS` | `9` | research §3 |
| `SLUG_FALLBACK_RANDOM_BYTES` | `2` | research §3 |
