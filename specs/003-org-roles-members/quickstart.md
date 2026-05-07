# Quickstart: Organizations, Roles & Members Verification

**Feature**: 003-org-roles-members
**Audience**: Developers verifying Phase 2 end-to-end behavior.

This walkthrough exercises every functional requirement and success criterion from
[spec.md](./spec.md). After completing it, all Phase 2 "Done When" criteria in
[docs/IMPLEMENTATION-PLAN.md](../../docs/IMPLEMENTATION-PLAN.md) should be satisfied.

---

## 0. Prerequisites

- Phase 1 (auth) quickstart completed — you have a registered, verified user.
- Server running (`pnpm dev`); Mailpit at `http://localhost:8025`.
- Export your `ACCESS_TOKEN` from Phase 1 login (used throughout as `$TOKEN`).

```bash
# Log in and capture access token
RESPONSE=$(curl -si -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}')
TOKEN=$(echo "$RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
```

---

## 1. Create an organization (FR-201; SC-201)

```bash
curl -i -X POST http://localhost:3000/api/v1/orgs \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Governance","description":"Test org"}'
```

Expected: `201 Created`. Body includes `onboardingStep: "PENDING_ROLES"`, `slug: "acme-governance"`.

Save the `id` from the response:

```bash
ORG_ID=<org id from response>
```

**Audit check**:

```bash
psql "$DATABASE_URL" -c "SELECT event, payload FROM audit_logs WHERE event='org.created' ORDER BY created_at DESC LIMIT 1;"
```

**Duplicate name check (FR-202)**:

```bash
curl -i -X POST http://localhost:3000/api/v1/orgs \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"ACME GOVERNANCE"}'
```

Expected: `409 DUPLICATE_ORG_NAME` (case-insensitive).

---

## 2. Verify onboarding gate (FR-203)

```bash
# Attempt org update — must be blocked at PENDING_ROLES
curl -i -X PATCH "http://localhost:3000/api/v1/orgs/$ORG_ID" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"description":"Should fail"}'
```

Expected: `403 FORBIDDEN` with onboarding-incomplete message.

```bash
# Read onboarding step — must be accessible at PENDING_ROLES (tier=always)
curl -i "http://localhost:3000/api/v1/orgs/$ORG_ID/onboarding" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `200`, `onboardingStep: "PENDING_ROLES"`.

---

## 3. Get system permissions and create a custom role (FR-205; FR-206; SC-202; SC-203)

```bash
# List permissions (accessible at PENDING_ROLES)
curl -i "http://localhost:3000/api/v1/orgs/$ORG_ID/roles/permissions" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `200`, array of 22 permission keys.

```bash
# Create a custom role
curl -i -X POST "http://localhost:3000/api/v1/orgs/$ORG_ID/roles" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Secretary","permissions":["meeting:create","meeting:view","minutes:create","minutes:edit","minutes:finalize"]}'
```

Expected: `201`. Save `role.id`:

```bash
ROLE_ID=<role id>
```

**Onboarding advance check**: `onboardingStep` must now be `PENDING_INVITES`.

```bash
curl -i "http://localhost:3000/api/v1/orgs/$ORG_ID/onboarding" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `onboardingStep: "PENDING_INVITES"` (FR-204).

**Privilege escalation check (SC-203)**: Alice is Owner so she holds all permissions.
Create a restricted member `bob` to test:

```bash
# (Covered properly in integration tests; manual test: try to create a role with
#  org:archive from a non-Owner member — expect PRIVILEGE_ESCALATION 403)
```

**Owner role immutability (FR-207)**:

```bash
# Get Owner role id
OWNER_ROLE_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM roles WHERE org_id='$ORG_ID' AND is_owner=true;" | tr -d ' ')

curl -i -X PATCH "http://localhost:3000/api/v1/orgs/$ORG_ID/roles/$OWNER_ROLE_ID" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Superuser"}'
```

Expected: `403 FORBIDDEN`.

---

## 4. Invite a member (FR-209; FR-210; SC-204)

```bash
curl -i -X POST "http://localhost:3000/api/v1/orgs/$ORG_ID/members/invitations" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"bob@example.com\",\"roleId\":\"$ROLE_ID\"}"
```

Expected: `201`. Check Mailpit for an invitation email to `bob@example.com` with
accept/decline links. Extract the token from the URL (64-char hex):

```bash
INVITE_TOKEN=<token from email URL>
```

**Duplicate invite check (FR-210)**:

```bash
curl -i -X POST "http://localhost:3000/api/v1/orgs/$ORG_ID/members/invitations" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"bob@example.com\",\"roleId\":\"$ROLE_ID\"}"
```

Expected: `409 PENDING_INVITE_EXISTS`.

---

## 5. Accept the invitation as a new user (FR-211; SC-205)

```bash
curl -i -X POST "http://localhost:3000/invitations/$INVITE_TOKEN/accept" \
  -H 'content-type: application/json' \
  -d '{"password":"bobsbigpassword99"}'
```

Expected: `200`. Body includes `membership` object and a non-null `accessToken`
(new user session started). Cookie `refresh_token` is set.

**Onboarding complete check** (SC-202):

```bash
curl -i "http://localhost:3000/api/v1/orgs/$ORG_ID/onboarding" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `onboardingStep: "COMPLETE"`.

**Audit check**:

```bash
psql "$DATABASE_URL" -c "SELECT event, payload FROM audit_logs WHERE org_id='$ORG_ID' ORDER BY created_at DESC LIMIT 5;"
```

Expected rows (newest first): `member.joined`, `member.invited`, `role.created`, `org.created`.

---

## 6. Member management (FR-212; SC-204)

```bash
# List members (accessible to all org members at COMPLETE)
curl -i "http://localhost:3000/api/v1/orgs/$ORG_ID/members" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `200`, two members (alice + bob).

```bash
# Get Bob's membership id
BOB_MEMBERSHIP_ID=$(psql "$DATABASE_URL" -t -c \
  "SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='bob@example.com' AND m.org_id='$ORG_ID';" | tr -d ' ')

# Remove Bob
curl -i -X DELETE "http://localhost:3000/api/v1/orgs/$ORG_ID/members/$BOB_MEMBERSHIP_ID" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `204`.

**Sole-Owner protection (SC-204)**:

```bash
# Get Alice's membership id
ALICE_MEMBERSHIP_ID=$(psql "$DATABASE_URL" -t -c \
  "SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='alice@example.com' AND m.org_id='$ORG_ID';" | tr -d ' ')

curl -i -X DELETE "http://localhost:3000/api/v1/orgs/$ORG_ID/members/$ALICE_MEMBERSHIP_ID" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `409 SOLE_OWNER`.

---

## 7. Decline an invitation (FR-211)

```bash
# Send a new invite to carol
curl -i -X POST "http://localhost:3000/api/v1/orgs/$ORG_ID/members/invitations" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"carol@example.com\",\"roleId\":\"$ROLE_ID\"}"

DECLINE_TOKEN=<token from carol's email URL>

curl -i -X POST "http://localhost:3000/invitations/$DECLINE_TOKEN/decline"
```

Expected: `200`, body `{ "success": true, "data": { "message": "Invitation declined." } }`.
No membership created for carol.

---

## 8. Archive organization (FR-213)

```bash
curl -i -X DELETE "http://localhost:3000/api/v1/orgs/$ORG_ID" \
  -H "authorization: Bearer $TOKEN"
```

Expected: `204`. Subsequent requests to org-scoped routes return `409 ORG_ARCHIVED`.

```bash
psql "$DATABASE_URL" -c "SELECT archived_at FROM organizations WHERE id='$ORG_ID';"
```

Expected: non-null `archived_at` timestamp; row still exists (no hard delete per FR-213).

---

## 9. Audit integrity (FR-215; SC-207)

```bash
psql "$DATABASE_URL" -c \
  "SELECT event FROM audit_logs WHERE org_id='$ORG_ID' ORDER BY created_at;"
```

Expected events (in order): `org.created`, `role.created`, `member.invited`,
`member.joined`, `member.removed`, `member.invited` (carol), `member.declined`,
`org.archived`.

All 12 event types from the spec are reachable by combining the above steps. Any
event missing from the log indicates an `emitAudit` call was omitted or not inside
the correct transaction.
