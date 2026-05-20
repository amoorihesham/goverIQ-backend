# Plan: Accept & Decline Invitation Endpoints

## Context

The invitations module currently supports list / get / create / delete (all behind auth + `requirePermission`), but invitees have no way to actually **act on** an invitation. The OpenAPI contract at [contracts/invitations-public.openapi.yaml](../specs/003-org-roles-members/contracts/invitations-public.openapi.yaml) defines two public endpoints — `POST /invitations/{token}/accept` and `POST /invitations/{token}/decline` — that are still unimplemented. The email template at [invitation.ts](../src/shared/notifications/templates/invitation.ts) already expects `acceptUrl` / `declineUrl`, but [invitions.service.ts:61-62](../src/modules/invitions/invitions.service.ts#L61-L62) sends them as empty strings, so the loop is broken end-to-end.

This change adds the two endpoints, wires the email URLs so invitees actually receive working links, and supports both existing-user and new-user (signup-via-invite) acceptance paths.

## Decisions (from clarification)

- **Auth:** Hybrid. Public token endpoint, but if a user already exists for `invitation.email`, require that user to be logged in **as that email** before accepting.
- **Accept scope:** Full spec — both existing-user (upsert membership) and new-user (create user + issue session) paths.
- **Decline:** Idempotent — returns 200 whether status is PENDING, DECLINED, or ACCEPTED. Only fails on unknown token (404) or expired (422).
- **Route placement:** Same `invitions.routes.ts`, public sub-paths (no `identityRequired` / `attachOrgId` / `requirePermission` prehandlers).

## Files to modify

### 1. `src/modules/invitions/schemas/zod.ts`
Add two new schemas:
- `acceptInvitationSchema` — params `{ token: string().length(64).regex(/^[a-f0-9]+$/) }`, body `{ password: string().min(12).optional() }`, 200 response shape mirroring contract (`membership`, `accessToken: string | null`).
- `declineInvitationSchema` — params `{ token }`, 200 response `{ message: string }`.

Export both from the module's existing zod barrel.

### 2. `src/modules/invitions/invitions.service.ts`
Add two new service methods next to `createInvitation`:

**`acceptInvitation(callerUserId: string | null, callerEmail: string | null, reqId: string, token: string, password?: string)`**

In a single `withTx` transaction:
1. `hashInviteToken(token)` → lookup invitation by `tokenHash` (single-row query). 404 if not found.
2. Validate `status === 'PENDING'`. If ACCEPTED/DECLINED → 409. If EXPIRED or `expiresAt <= now()` → 422 (and update status to EXPIRED if past expiry but still PENDING).
3. Lookup user by `invitation.email`.
4. **Hybrid auth gate:**
   - If user exists and `callerUserId` is null → 401 with code `LOGIN_REQUIRED` (frontend should redirect to login carrying the token).
   - If user exists and `callerEmail !== invitation.email` → 403 `EMAIL_MISMATCH`.
   - If user does not exist → require `password` (400 `PASSWORD_REQUIRED` if missing); create user via `hashPassword` ([password.ts](../src/modules/auth/utils/password.ts)) with `isVerified: true`.
5. Upsert membership in `memberships`: if `(userId, orgId)` row exists, update `roleId`; else insert.
6. Update invitation `status = 'ACCEPTED'`.
7. Advance org onboarding: if `org.onboardingStep === 'PENDING_INVITES'` set to `'COMPLETE'`.
8. Emit `member.joined` audit event via [emitAudit](../src/shared/audit/emitter.ts).
9. **New-user path only:** issue session inline (mirror the pattern in [auth.service.ts:19-40](../src/modules/auth/auth.service.ts#L19-L40)) — generate refresh token cleartext via [tokens.ts](../src/modules/auth/utils/tokens.ts), store hash, sign access JWT. Return `{ accessToken, refreshTokenCleartext }`.
10. Return `{ membership: { id, orgId, roleId, joinedAt }, accessToken: string | null, refreshTokenCleartext: string | null }` to the controller (controller decides what to expose vs. set as cookie).

**`declineInvitation(reqId: string, token: string)`**

In a `withTx`:
1. Hash token, lookup invitation. 404 if missing.
2. If `expiresAt <= now()` and still PENDING → 422 (also update to EXPIRED).
3. If already DECLINED → return 200 idempotent (no audit re-emit).
4. If PENDING → set `status = 'DECLINED'`, emit `member.declined` audit.
5. If ACCEPTED → return 200 with a message indicating it was already accepted (spec treats decline as idempotent and decline-after-accept as a no-op success; we will not roll back membership).
6. Return `{ message: 'Invitation declined' }` (or appropriate variant).

### 3. `src/modules/invitions/invitions.controller.ts`
Add two handlers:

**`acceptInvitation`**
- Read optional identity from `request.user` (set by `identityRequired` only when present — for hybrid we pass it through but do NOT require it via prehandler; instead, read the JWT manually if a cookie/Bearer is present using the same logic as [identity.ts](../src/shared/auth/identity.ts), or extract that decode logic into a `tryIdentity` helper).
- Call `service.acceptInvitation(...)`.
- If `refreshTokenCleartext` returned (new-user path), set it as httpOnly cookie (`SameSite=Lax`, `Secure` in prod) matching the cookie pattern used by `auth.controller.ts` login.
- Reply `{ membership, accessToken }`.

**`declineInvitation`**
- Call `service.declineInvitation(...)`.
- Reply `{ message }`.

### 4. `src/modules/invitions/invitions.routes.ts`
Append two **public** routes (no prehandlers):

```ts
fastify.withTypeProvider<ZodTypeProvider>().post(
  '/:token/accept',
  { schema: acceptInvitationSchema },
  controller.acceptInvitation,
);

fastify.withTypeProvider<ZodTypeProvider>().post(
  '/:token/decline',
  { schema: declineInvitationSchema },
  controller.declineInvitation,
);
```

### 5. `src/modules/invitions/invitions.service.ts` — `createInvitation` fix
Populate `acceptUrl` and `declineUrl` instead of empty strings. Read a base URL from config (e.g. `CONFIGURATION.PUBLIC_APP_URL` or similar — verify the exact key during implementation). Construct:
- `acceptUrl = ${base}/invitations/${rawToken}/accept`
- `declineUrl = ${base}/invitations/${rawToken}/decline`

These point to a frontend page that POSTs to the API (or directly to API endpoints if the email links can carry POST). If the frontend route shape differs, adjust accordingly during implementation — confirm with frontend conventions before merging.

### 6. New helper: `tryIdentity` (optional but clean)
In [identity.ts](../src/shared/auth/identity.ts), add `tryIdentity` — same JWT extraction logic as `identityRequired` but does not throw if missing/invalid; just leaves `request.user` undefined. Used by accept controller to support the hybrid flow without forcing auth.

## Reused utilities (do not reimplement)

- [hashInviteToken / generateInviteToken](../src/modules/invitions/utils/invite-token.ts)
- [hashPassword](../src/modules/auth/utils/password.ts)
- [generateRefreshTokenCleartext / hashRefreshToken](../src/modules/auth/utils/tokens.ts)
- [signToken](../src/modules/auth/utils/jwt.ts) (or equivalent — verify path)
- [withTx](../src/shared/database/transaction.ts)
- [emitAudit](../src/shared/audit/emitter.ts)
- Cookie-setting pattern from `auth.controller.ts` login handler

## Error mapping summary

| Case | Status | Code |
|---|---|---|
| Unknown token | 404 | `INVITATION_NOT_FOUND` |
| Already ACCEPTED/DECLINED (accept only) | 409 | `INVITATION_NOT_PENDING` |
| Expired | 422 | `INVITATION_EXPIRED` |
| User exists but not logged in | 401 | `LOGIN_REQUIRED` |
| Logged-in email mismatch | 403 | `EMAIL_MISMATCH` |
| New user but no password | 400 | `PASSWORD_REQUIRED` |
| Decline (any prior terminal state) | 200 | — (idempotent) |

## Verification

1. **Unit / service tests** (Vitest, following patterns in existing `*.service.test.ts`):
   - Accept: PENDING + existing user logged-in → membership upserted, status ACCEPTED, `member.joined` audited, onboarding advanced.
   - Accept: PENDING + new email + password → user created with `isVerified=true`, refresh token persisted, access token returned.
   - Accept: existing user, no auth → 401 `LOGIN_REQUIRED`.
   - Accept: existing user, wrong logged-in email → 403 `EMAIL_MISMATCH`.
   - Accept: expired → 422 and status flips to EXPIRED.
   - Accept: already ACCEPTED → 409.
   - Decline: PENDING → 200, status DECLINED, audit emitted.
   - Decline: already DECLINED → 200, no duplicate audit.
   - Decline: unknown token → 404.

2. **Integration (route-level)** test: create invitation via existing POST, capture the raw token returned from create flow (or stub `generateInviteToken`), then POST to accept/decline and assert DB state + response.

3. **Manual smoke** (Fastify dev server):
   - Create org + role + invitation via existing protected endpoints.
   - Inspect logged email payload (dispatcher) to confirm `acceptUrl`/`declineUrl` are now populated with real URLs containing the raw token.
   - `curl -X POST /invitations/<token>/decline` → 200.
   - `curl -X POST /invitations/<token>/accept -d '{"password":"…"}'` for a new email → 200 with `accessToken` and Set-Cookie.

4. **Audit log check:** Query `audit_logs` to confirm `member.joined` and `member.declined` entries with correct `actorId`, `orgId`, and metadata.

## Out of scope

- Background job to flip `PENDING → EXPIRED` for invitations past `expiresAt` (the endpoints handle lazy expiry on access).
- Resend / regenerate invitation flow.
- Bulk accept/decline.
- Frontend pages that consume these endpoints.
