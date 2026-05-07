# Feature Specification: Authentication Module

**Feature Branch**: `002-auth-module`
**Created**: 2026-05-03
**Status**: Draft
**Input**: User description: "Authentication Module, we want to build the Authentication module as a baseline for all the rest of the project functionality."

## Clarifications

### Session 2026-05-03

- Q: What is the minimum password length policy? → A: 12 characters minimum, no further complexity rules (length-only policy per NIST SP 800-63B guidance)
- Q: How should brute-force login attempts be handled in this phase? → A: No per-account lockout; rely on Phase 5 per-IP rate-limiting (avoids account-lockout DoS amplification)
- Q: What happens when an email belonging to an unverified account is re-registered? → A: The prior unverified user record and verification record are deleted and replaced atomically with a fresh pair; `DUPLICATE_EMAIL` is reserved for emails belonging to a verified account
- Q: How should email-delivery failure during registration be surfaced to the caller? → A: Registration returns 201 regardless of delivery outcome (preserves Phase 0 fire-and-forget contract); user invokes the resend flow if no email arrives

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Self-service account creation with email verification (Priority: P1)

A first-time visitor creates an account with their email and a password, receives a
verification code by email, submits the code, becomes a verified user, and immediately
starts an authenticated session — without any administrator involvement.

**Why this priority**: Until a user can sign up and prove ownership of their email,
nothing else in the platform is reachable. This is the entry point for every other
domain module — organizations, meetings, votes, minutes — and must work end-to-end on
the very first deploy.

**Independent Test**: Submit registration with a fresh email and password, observe a
verification email is delivered, submit the code, and verify the response includes an
authenticated session that can be used to call any subsequent protected endpoint.

**Acceptance Scenarios**:

1. **Given** an unused email and a password meeting the minimum length policy, **When**
   the user registers, **Then** an account is created in an unverified state and a
   verification code is delivered to the email
   1a. **Given** an email that already belongs to an unverified account, **When** the
   user registers again, **Then** the prior unverified record is replaced atomically
   with a fresh pair and a new verification code is delivered
   1b. **Given** an email that already belongs to a verified account, **When** anyone
   attempts to register with it, **Then** the request is rejected with `DUPLICATE_EMAIL`
2. **Given** an unverified user with an active verification code, **When** they submit
   the correct code before it expires, **Then** the account becomes verified and an
   authenticated session is started immediately in the same operation
3. **Given** an unverified user with an expired verification code, **When** they submit
   the code, **Then** the request is rejected with an `OTP_EXPIRED` error and the user
   remains unverified
4. **Given** an unverified user, **When** they submit an incorrect code, **Then** the
   request is rejected with `INVALID_CREDENTIALS` and the user remains unverified

---

### User Story 2 - Returning user login (Priority: P1)

A previously verified user signs in with their email and password and receives an
authenticated session.

**Why this priority**: Verification is one-time; login is the recurring entry point for
every active user on every device. It must enforce the verified-user invariant and must
not leak information about which emails are registered.

**Independent Test**: Pre-create a verified user, attempt login with the correct
credentials, attempt login with the wrong password, attempt login with an unknown email,
and attempt login with an unverified email — verify only the first succeeds and the
remaining three are indistinguishable to the caller.

**Acceptance Scenarios**:

1. **Given** a verified user, **When** they submit correct email and password, **Then**
   they receive an authenticated session
2. **Given** a verified user, **When** they submit the correct email but the wrong
   password, **Then** the request is rejected with `INVALID_CREDENTIALS`
3. **Given** an email that does not belong to any account, **When** a login is
   attempted, **Then** the response is identical (status code and body) to the
   wrong-password response — no enumeration of registered emails is possible
4. **Given** an unverified user, **When** they submit correct credentials, **Then** the
   request is rejected with `UNAUTHORIZED` and no session is started

---

### User Story 3 - Continuous session with rotation and theft detection (Priority: P1)

A signed-in user's short-lived access credential is renewed silently while the
long-lived session credential is still valid. If the long-lived credential is ever
replayed (i.e. used after it has been rotated), every active session for that user is
terminated immediately as a theft-recovery measure.

**Why this priority**: Without rotation, a compromised credential is valid for its full
lifetime; without replay detection, a stolen credential is indistinguishable from the
legitimate user's. The combination is the minimum bar for a credible session model and
must ship with login itself, not as a follow-up.

**Independent Test**: Log in, capture the long-lived credential value, exchange it for
a refreshed pair (observing both values change), then attempt to exchange the _original_
captured value again — verify the second exchange is rejected and that any other
in-flight session for the same user is also invalidated.

**Acceptance Scenarios**:

1. **Given** a signed-in user with a valid long-lived credential, **When** they request
   a refresh, **Then** they receive a new short-lived credential and a new long-lived
   credential, and the previous long-lived credential is invalidated
2. **Given** a long-lived credential that has already been rotated, **When** anyone
   presents it again, **Then** the request is rejected with `UNAUTHORIZED` and **all**
   long-lived credentials for the affected user are invalidated server-side
3. **Given** a long-lived credential that has expired naturally, **When** the user
   presents it, **Then** the request is rejected with `UNAUTHORIZED` and the expired
   record is cleaned up
4. **Given** a refresh request with no long-lived credential present, **When** it is
   received, **Then** it is rejected with `UNAUTHORIZED`

---

### User Story 4 - Resend verification code with abuse guard (Priority: P2)

A user whose verification email did not arrive (or who lost it) requests a fresh
verification code. To prevent the resend channel being abused as a free email-spam
vector, repeated requests inside a short window are rejected.

**Why this priority**: Without resend, a user who misses the first email is locked out
permanently. Without the cooldown, the resend endpoint becomes an outbound-spam vector.
Both halves are needed, but the flow is a recovery path — verification through the
normal flow (US1) is the dominant case.

**Independent Test**: Register a user, immediately request a resend (rejected with
cooldown), wait past the cooldown window, request again (succeeds and a new code is
delivered), verify the new code works and the previous code no longer does.

**Acceptance Scenarios**:

1. **Given** a registered user inside the cooldown window from their last code
   delivery, **When** they request a resend, **Then** the request is rejected with
   `OTP_COOLDOWN`
2. **Given** a registered user past the cooldown window, **When** they request a
   resend, **Then** a new verification code is delivered and the previously issued code
   is replaced
3. **Given** an email that does not belong to any account, **When** a resend is
   requested, **Then** the response is identical to the cooldown-rejected case so no
   enumeration of registered emails is possible

---

### User Story 5 - Explicit sign-out (Priority: P2)

A signed-in user ends their session immediately on the current device. The long-lived
credential for that session is invalidated server-side and the client-side cookie is
cleared.

**Why this priority**: Sign-out is required for shared devices and explicit session
termination; the security model relies on the user being able to revoke their own
session at will. It is P2 rather than P1 because natural credential expiry already
bounds session lifetime in the absence of explicit logout.

**Independent Test**: Log in, capture the long-lived credential, call sign-out (verify
204 with cookie cleared), then attempt to refresh with the captured credential — verify
the refresh is rejected.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they sign out, **Then** the response status is
   204, the cookie is cleared, and the long-lived credential is invalidated
   server-side
2. **Given** the previous long-lived credential value from a now-signed-out session,
   **When** any caller presents it for refresh, **Then** the request is rejected with
   `UNAUTHORIZED`
3. **Given** a request with no long-lived credential present, **When** sign-out is
   called, **Then** the response is still 204 — sign-out is idempotent and does not
   error on already-signed-out callers

---

### Edge Cases

- Two simultaneous registrations for the same email — exactly one succeeds; the other
  is rejected with `DUPLICATE_EMAIL`. No partial state is left behind.
- A user registers, never verifies (whether the verification code has expired or
  not), then attempts to register again with the same email. The system must allow
  this — the prior unverified user and verification records are deleted and
  replaced atomically with a fresh pair, not rejected as a duplicate. The
  `DUPLICATE_EMAIL` error is reserved for re-registration against a verified
  account.
- A verification code submitted just after expiry (clock skew, slow user). Treated the
  same as any expired code: `OTP_EXPIRED`, no partial state change.
- A long-lived credential whose stored record was deleted server-side (theft signal)
  vs. a request that simply has no cookie attached. The first is a security event and
  triggers user-wide invalidation; the second is just an unauthenticated request and
  triggers nothing beyond the rejection.
- Login attempts against an account that does not yet exist must be byte-equivalent in
  status and body to login attempts against an account with a wrong password. Any
  divergence — different status, different timing, different body — leaks information.
- Audit emission when the wrapping transaction rolls back — under no circumstances may
  a `user.registered` (or any auth audit event) row be visible after its parent
  transaction was aborted. The verification check is to inject a forced rollback after
  the audit emission and confirm zero rows remain.
- Email delivery silently fails after a successful registration — the user has a
  valid account but no code in their inbox. The system response is unchanged
  (registration still returns 201); the user recovers via the resend flow once the
  cooldown elapses. There is no automatic retry or alternate notification path.
- A logout call that arrives twice (network retry). Both responses are 204 and the
  account state is unchanged — sign-out is idempotent.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-101**: System MUST allow a new user to register with an email and password.
  Email format MUST be validated; password MUST be at least 12 characters in length
  (no additional complexity rules — no required digits, symbols, or mixed case);
  password storage MUST be one-way (irreversible). Registration MUST create the user
  in an unverified state and trigger a verification-code delivery, all atomically —
  either the user, the verification record, and the audit entry all exist together,
  or none of them do. If the submitted email already belongs to an **unverified**
  account, registration MUST atomically delete the prior user record and its
  associated verification record and create a fresh pair (with a new password hash
  and a new verification code), all in the same transaction; `DUPLICATE_EMAIL` MUST
  be returned only when the email belongs to a **verified** account.
- **FR-102**: System MUST issue a single-use, time-bounded verification code by email
  on registration and on demand via resend. The code MUST be stored as a one-way hash
  only — the cleartext code MUST never be persisted — and verified by hash comparison.
  At most one active verification record per user MUST exist; resends replace any
  prior active record. Email-delivery failure MUST NOT cause the registration or
  resend operation to fail or roll back; delivery is fire-and-forget (failures are
  logged, never propagated to the caller, per Phase 0 FR-005). Users who never
  receive an email recover via the resend flow.
- **FR-103**: System MUST enforce a cooldown between successive verification-code
  resends to the same account. Resend requests inside the cooldown window MUST be
  rejected with the `OTP_COOLDOWN` error code. The cooldown window MUST start from
  the timestamp of the last successful delivery.
- **FR-104**: On successful submission of the correct, non-expired verification code,
  system MUST mark the user verified, delete the verification record, and start a
  session — all in the same database transaction. A failure in any step MUST roll back
  every step.
- **FR-105**: System MUST refuse login for any user whose verified flag is false,
  returning `UNAUTHORIZED`. The response MUST be byte-equivalent to the
  invalid-credentials response so that a caller cannot distinguish "unverified" from
  "wrong password".
- **FR-106**: For login attempts where the email does not match any account, system
  MUST return the same response (status code and body) as for a wrong password —
  `UNAUTHORIZED` / `INVALID_CREDENTIALS` — to prevent email enumeration. The same
  rule applies to resend-verification requests against unknown emails.
- **FR-107**: On successful login and on successful verification, system MUST issue
  (a) a short-lived stateless access credential carrying caller identity (user ID,
  email — explicitly no role and no organization context, both of which are resolved
  per-request in later phases) and (b) a long-lived opaque session credential
  delivered as an httpOnly, sameSite-protected cookie. The long-lived credential MUST
  be stored only as a one-way hash; the cleartext value MUST never be persisted.
- **FR-108**: On every refresh request, system MUST hash the presented long-lived
  credential, locate the matching stored record, delete it, insert a new record with a
  fresh long-lived credential, and rotate the cookie — all in a single database
  transaction. Both the access credential and the long-lived credential MUST change
  on every refresh.
- **FR-109**: If a refresh request presents a long-lived credential whose hash does
  not match any stored record, system MUST treat it as a token-reuse theft signal:
  delete every long-lived credential record for the affected user (identified through
  the credential's claim) and respond with `UNAUTHORIZED`. If the hash matches a
  record that has expired, system MUST delete that record and respond with
  `UNAUTHORIZED` — no theft-wide cleanup. If no long-lived credential is presented at
  all, system MUST respond with `UNAUTHORIZED` and take no other action.
- **FR-110**: On sign-out, system MUST delete the long-lived credential record
  matching the presented credential (if any) and clear the cookie. Sign-out MUST be
  idempotent — a sign-out call without any credential, or with one that does not match
  any record, MUST still return 204 with the cookie cleared and MUST NOT raise an
  error.
- **FR-111**: System MUST expose a request-level identity guard usable as a
  pre-handler on any protected route. The guard MUST validate the access credential,
  attach `{ userId, email }` to the request context, and reject missing or malformed
  credentials with `UNAUTHORIZED`, malformed-but-syntactically-valid credentials with
  `INVALID_TOKEN`, and expired credentials with `TOKEN_EXPIRED`.
- **FR-112**: System MUST emit an audit log entry for each of `user.registered`,
  `user.verified`, `user.login`, and `user.logout`. Each entry MUST be written via the
  shared audit emitter inside the same transaction as the originating write. The
  `org_id` field MUST be null on all four events because no organization context
  exists in this phase.
- **FR-113**: System MUST validate every required configuration variable for this
  module at startup. The process MUST refuse to start if any required variable is
  missing, and MUST refuse to start if any signing-secret variable fails the minimum
  strength check. Startup error output MUST identify the failing variable by name.

### Key Entities

- **User**: The identity record. Holds email (unique, case-insensitive),
  password-as-hash, and verified flag. The only entity that survives sign-out.
- **Verification Record**: A single-active-per-user record carrying the
  verification-code hash, the expiry timestamp, and the last-sent timestamp (the
  cooldown anchor). Replaced on every resend; deleted on successful verification.
- **Long-Lived Session Credential**: A server-side record of an active session.
  Stored only as a hash. One row per active credential per device. Rotates on every
  refresh; deleted on sign-out, on theft detection, or on expiry.
- **Short-Lived Access Credential**: A stateless caller-identity carrier issued at
  login or verification and on every refresh. Never persisted server-side; carries
  user ID and email only.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-101**: A new user can complete registration → verification → first
  authenticated request in under 60 seconds end-to-end, assuming the verification
  email arrives within typical delivery latency.
- **SC-102**: Login completes in under 200 ms at p95 against a database holding at
  least 10,000 users, matching the platform-wide latency budget.
- **SC-103**: 100% of test scenarios that replay an already-rotated long-lived
  credential trigger the user-wide invalidation path; zero scenarios allow a
  previously-rotated credential to be reused.
- **SC-104**: 100% of test scenarios where an unverified user attempts to log in are
  rejected — no implementation defect ever permits an unverified-user session.
- **SC-105**: 100% of audit-rollback scenarios — where a registration is wrapped in a
  transaction that is forcibly aborted — leave zero `user.registered` rows in the
  audit log.
- **SC-106**: Wrong-password and unknown-email login responses are byte-equal in
  status code and response body, verified by an automated test that diffs the two
  responses.
- **SC-107**: Sign-out is idempotent — repeated invocations against the same already
  signed-out session produce the same 204 response with no error and no state change.

## Assumptions

- Email delivery uses the existing notification service from Phase 0; specific SMTP
  or third-party provider configuration is an infrastructure concern outside the
  scope of this feature.
- The existing data schema for `users`, `email_verifications`, and `refresh_tokens`
  delivered in Phase 0 is sufficient — this feature does not introduce new tables or
  alter existing columns.
- Concrete numeric values — verification code length, code expiry duration, resend
  cooldown duration, access credential lifetime, long-lived credential lifetime —
  are implementation details set during planning and tuning. The specification
  commits only to "short-lived" vs. "long-lived" and to the existence of a cooldown
  window; specific minutes/hours/days are not part of the contract.
- Cookie attributes — `httpOnly`, `secure` in production, `sameSite=lax`, path `/` —
  are chosen during planning. The specification commits only to "delivered as a
  cookie that the browser does not expose to scripts and that is not sent on
  cross-site requests by default".
- Rate-limiting on auth endpoints (`/auth/register`, `/auth/login`,
  `/auth/resend-otp`) is **out of scope** for this feature and is delivered as part
  of the Phase 5 security-hardening pass.
- Per-account lockout after repeated failed login attempts is **explicitly not
  implemented** in this feature. Repeated failures continue to return
  `INVALID_CREDENTIALS` indefinitely. Brute-force defense is delivered solely by
  per-IP rate-limiting in Phase 5; per-account lockout is rejected as a control
  because it enables an attacker who knows a victim's email to deny service to that
  account.
- Password reset, OAuth/SSO, multi-factor authentication beyond email verification,
  and account deletion are **out of scope** for this feature.
- Organization-scoped permission resolution is **out of scope** — the access
  credential intentionally carries no role or organization claim. Permission
  resolution is delivered in Phase 2 (Org / Roles / Members).
- The error-code registry currently lacks `OTP_EXPIRED` and `OTP_COOLDOWN`; adding
  them is implementation work for the planning phase, not a clarification of this
  spec.
