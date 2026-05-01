# Feature Specification: Project Bootstrap — Schema & Shared Infrastructure

**Feature Branch**: `001-project-bootstrap`
**Created**: 2026-05-01
**Status**: Draft
**Input**: User description: "Project Bootstrapping — bootstrap a new backend project to start working on project modules (Phase 0)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean Database Deployment (Priority: P1)

An operator deploys the application to a fresh environment with an empty database. After
starting the system, all required data storage structures are in place and the system is
ready for domain modules to operate.

**Why this priority**: The data schema is the foundation every other module depends on.
Nothing can function without it. It must be correct, complete, and deployable in a single
step from a blank state.

**Independent Test**: Start the application against a blank database. Verify all 17 data
tables exist with the correct structure. Verify that re-running the migration does not
cause errors or data loss.

**Acceptance Scenarios**:

1. **Given** a blank database, **When** the application starts, **Then** all 17 data tables
   are created successfully in a single operation
2. **Given** a fully-migrated database, **When** the application starts again, **Then**
   the migration completes without errors and existing data is preserved
3. **Given** a database connection that is refused at startup, **When** the application
   starts, **Then** it refuses to start and outputs a clear connectivity error

---

### User Story 2 - Shared Infrastructure Available to Domain Modules (Priority: P1)

A developer building any domain module (auth, org, meetings, votes, minutes) can rely on
shared infrastructure — permission enforcement, transactional audit logging, standard error
formatting, and notification delivery — without reimplementing cross-cutting concerns.

**Why this priority**: Without shared infrastructure every domain module would implement
its own permission checks, audit logic, and error shapes, leading to inconsistency and
duplication. This is a blocking prerequisite for all domain modules.

**Independent Test**: Verify each shared component is callable in isolation. Confirm the
audit emitter commits and rolls back with its parent transaction. Confirm the permission
guard resolves membership per-request without caching. Confirm the error helpers produce
the correct envelope shapes.

**Acceptance Scenarios**:

1. **Given** a domain module calls the audit emitter with a transaction handle, **When**
   the transaction commits, **Then** the audit entry is persisted
2. **Given** a domain module calls the audit emitter with a transaction handle, **When**
   the transaction rolls back, **Then** the audit entry is discarded with it (no ghost entries)
3. **Given** a request with valid credentials from a caller who holds the Owner role,
   **When** the permission guard runs, **Then** it passes unconditionally regardless of
   which permission is required
4. **Given** a request with valid credentials from a caller who lacks the required
   permission, **When** the permission guard runs, **Then** it blocks the request with a
   FORBIDDEN error
5. **Given** any domain operation produces a result, **When** the response is serialized,
   **Then** it conforms to the standard `{ success, data }` or `{ success, error }` envelope

---

### User Story 3 - Safe Startup Validation (Priority: P2)

An operator running the application in any environment receives an immediate, clear error
if the environment is misconfigured — before the application accepts any requests.

**Why this priority**: Silent misconfiguration leads to hard-to-diagnose runtime failures.
Catching it at startup prevents data loss, security gaps, and partial-failure states.

**Independent Test**: Start the application with a required environment variable missing.
Verify the process exits with a non-zero code and identifies the missing variable. Start
with all variables present and verify the application starts normally.

**Acceptance Scenarios**:

1. **Given** a required environment variable is missing, **When** the application starts,
   **Then** it refuses to start and outputs the name of the missing variable
2. **Given** a secret variable whose value is too short to be secure (e.g., a signing key
   below minimum length), **When** the application starts, **Then** it refuses to start
   with a descriptive validation error identifying the variable
3. **Given** all required environment variables are present and valid, **When** the
   application starts, **Then** it starts successfully and begins accepting requests

---

### Edge Cases

- What happens when the migration has partially run and the database is in an inconsistent state?
- What happens if the notification delivery mechanism is unavailable at the time of sending? (fire-and-forget: failure is logged, not propagated to the caller)
- What if the audit emitter is called without a transaction handle? (programming error — must fail loudly, not silently write outside a transaction)
- What if two concurrent migrations are attempted against the same database simultaneously?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST create all 17 data tables in a single, atomic migration operation
  against a blank database; partial schema states MUST NOT be possible after migration;
  the migration runner MUST acquire an exclusive advisory lock on the database before
  executing so that concurrent instances wait or fail fast rather than racing
- **FR-002**: System MUST expose a fixed registry of 22 permission keys as typed, named
  constants; the set MUST be immutable at runtime and organizations MUST NOT be able to
  add or remove entries
- **FR-003**: System MUST produce all API responses in a standard envelope:
  `{ success: true, data: {...} }` for successes and
  `{ success: false, error: { code, message, statusCode } }` for errors; no endpoint
  may deviate from this shape
- **FR-004**: System MUST provide an audit emitter that accepts a transaction handle and
  writes the audit entry as part of that transaction; the emitter MUST NOT accept a
  global database connection in place of a transaction handle; the `org_id` field MUST
  be nullable to support pre-org audit events (registration, login) that have no org context
- **FR-005**: System MUST provide a notification abstraction supporting at minimum two
  delivery templates: email-verification (OTP delivery) and invitation (accept/decline
  links); delivery failures MUST be logged and MUST NOT propagate errors to callers
- **FR-006**: System MUST provide a permission guard that on every protected request:
  validates the access credential, resolves the caller's org membership from the database
  (no caching), grants unconditional pass to callers with the Owner role, and rejects
  callers missing the required permission with a FORBIDDEN error; if the target org does
  not exist, the guard MUST return FORBIDDEN (not NOT_FOUND) to prevent org-existence
  enumeration by unauthorized callers
- **FR-007**: System MUST refuse to start if any required configuration variable is
  missing or fails minimum-value validation; the startup error MUST identify the specific
  failing variable(s) by name
- **FR-008**: System MUST define a complete, fixed set of machine-readable error codes
  used consistently by all domain modules; no domain module may introduce ad-hoc error
  shapes outside this set
- **FR-009**: System MUST expose a health-check endpoint requiring no authentication that
  performs a lightweight database connectivity check and returns the server's operational
  status and current timestamp; if the database is unreachable the endpoint MUST return
  a degraded status with a non-2xx response so load balancers can route away from the instance

### Key Entities

- **Permission**: A named capability key from the fixed 22-key system set; roles hold
  collections of permissions and organizations cannot extend the set
- **Audit Entry**: An immutable record written transactionally with every state-changing
  operation; fields: actor, event type, entity type, entity ID, org ID (nullable for
  pre-org events such as user registration and login), payload, timestamp
- **Access Credential**: A short-lived, stateless token identifying the caller (user ID,
  email); carries no role or org context — those are resolved per-request
- **Error Code**: A machine-readable string from the fixed error registry; always paired
  with an HTTP status code and a human-readable message in the response envelope

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 17 tables are created from a blank database in a single migration run
  that completes without errors and leaves no partial state on failure
- **SC-002**: The permission guard correctly allows or blocks access in 100% of test
  scenarios covering: valid credentials with sufficient permission, valid credentials
  without required permission, expired credentials, and Owner-role bypass
- **SC-003**: Audit entries are confirmed to roll back with their parent transaction —
  verified by inducing a forced transaction rollback and confirming no orphan audit row
  exists in the database
- **SC-004**: The application refuses to start and outputs the missing variable name
  within 5 seconds of launch when any required configuration variable is absent
- **SC-005**: Notification delivery failures produce no error propagation to callers in
  test scenarios that simulate a complete delivery outage
- **SC-006**: The health-check endpoint returns a non-2xx status within 2 seconds when
  the database is unreachable, and returns 200 with correct status and timestamp when
  the database is reachable
- **SC-007**: When two migration runners start simultaneously against the same database,
  exactly one completes successfully and the other either waits for the lock and exits
  cleanly or fails fast — the schema is never left in a partial state

## Clarifications

### Session 2026-05-01

- Q: When auth events are written to the audit log, should `org_id` be nullable (null for pre-org operations) or required? → A: `org_id` is nullable; auth events (registration, login, verification, logout) store null for org_id since no org context exists at that stage
- Q: When the permission guard receives a request for an org that does not exist, what error should be returned? → A: FORBIDDEN (403) — org existence is not disclosed to prevent enumeration attacks
- Q: Should the health-check endpoint verify database connectivity or only confirm the HTTP server is responding? → A: Shallow DB ping — lightweight connectivity check included; returns degraded/503 if DB is unreachable
- Q: Should the migration system protect against concurrent execution by multiple instances? → A: Migration MUST acquire an exclusive advisory lock before executing; concurrent runners wait or fail fast

## Assumptions

- The target runtime environment provides a relational database; the specific engine is
  determined during planning and does not affect this specification
- Notification delivery in the MVP is email-based; the underlying transport (SMTP,
  third-party email API) is an implementation detail resolved at planning time
- The 22-permission set is fixed as defined in the implementation plan and will not be
  extended as part of this feature
- The access credential format (short-lived, stateless, no role/org context) is
  established in this phase and used unchanged by all subsequent domain modules
- Network-level security (TLS, firewall rules, load balancer termination) is handled by
  infrastructure outside the application boundary and is out of scope for this feature
- The health-check endpoint is used by load balancers and uptime monitors; no
  authentication or detailed diagnostics are required in the MVP response
