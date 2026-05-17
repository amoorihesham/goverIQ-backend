# Feature Specification: Audit, Hardening & Deployment

**Feature Branch**: `006-audit-hardening-deployment`
**Created**: 2026-05-17
**Status**: Draft
**Input**: User description: "The audit log is queryable and exportable via API. The system is secured, documented, and ready for production deployment."

## Clarifications

### Session 2026-05-17

- Q: Where are the rate-limit counters maintained, given the multi-instance deployment model? → A: Rate limiting is not implemented in the application at all; it is delegated entirely to the cloud provider's API gateway / edge layer.
- Q: How is credential material kept out of what the audit query and export return? → A: A read-time redaction step strips a defined deny-list of sensitive fields from the change payload before any query or export returns it; the stored audit record is left unchanged.
- Q: Is operational observability (application logging) part of this feature's scope? → A: Yes — all production code paths must emit structured (JSON) operational logs for request handling and errors; operational metrics and distributed tracing are out of scope.
- Q: How deep is the health check? → A: Two unauthenticated endpoints — `/health/live` (shallow liveness; process responsive, no dependency probe) and `/health/ready` (readiness; also verifies the database is reachable).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Query the organization audit log (Priority: P1)

A member holding the audit-view permission opens their organization's audit log and
inspects the complete history of governance actions — who did what, to which entity,
and when. They narrow the view with filters (a specific actor, a specific event type,
an entity type, a single entity, a date range) and page through the results in
reverse-chronological order.

**Why this priority**: Every prior phase has been writing audit entries, but until this
story ships there is no way to read them back. This is the first time the accumulated
audit trail becomes observable through the system itself, and it is the headline
deliverable of the phase. An organization cannot demonstrate accountability or
investigate an incident without it.

**Independent Test**: Exercise any audited flow (for example, create an organization
and invite a member), then call the audit query and confirm the corresponding entries
are returned with actor, event, entity, payload, and timestamp. Apply each filter
individually and in combination and confirm the result set narrows correctly.

**Acceptance Scenarios**:

1. **Given** an organization with a history of audited actions, **When** a member with
   `audit:view` queries the audit log with no filters, **Then** entries are returned
   newest-first, each including the actor identity, the event type, the entity type and
   entity ID, the recorded change payload, and an ISO 8601 timestamp.
2. **Given** more audit entries than a single page holds, **When** the member requests
   the first page, **Then** a bounded page of results plus a token for the next page is
   returned; following that token returns the subsequent page with no gaps and no
   duplicates.
3. **Given** an audit log spanning many event types and actors, **When** the member
   filters by any combination of actor, event type, entity type, entity ID, and a
   start/end date range, **Then** only entries matching every supplied filter are
   returned.
4. **Given** a member who does not hold `audit:view`, **When** they attempt to query the
   audit log, **Then** the request is rejected with `FORBIDDEN` and no entries are
   returned.
5. **Given** two organizations that each have their own audit history, **When** a member
   of one organization queries the audit log, **Then** only that organization's entries
   are ever returned — no entry belonging to another organization is visible regardless
   of the filters supplied.

---

### User Story 2 - Export the audit log for compliance and archival (Priority: P2)

A member holding the audit-export permission produces a downloadable file of the audit
log — the full filtered set, not a single page — for regulatory submission, external
archival, or offline review. They choose a spreadsheet-compatible format or a
human-readable document format.

**Why this priority**: Querying the log covers day-to-day inspection, but governance and
compliance obligations require a portable, self-contained record that can be filed,
shared with auditors, or retained outside the system. Export builds directly on the
query capability and extends it; it delivers clear value but is not required for the
audit trail to be observable.

**Independent Test**: Build up an audit history, request an export in each supported
format with a chosen filter set, and confirm the downloaded file is well-formed and
contains exactly the entries the equivalent query returns across all of its pages.

**Acceptance Scenarios**:

1. **Given** an organization with audit history, **When** a member with `audit:export`
   requests an export in the spreadsheet-compatible format, **Then** a complete flat
   file containing every entry matching the supplied filters is returned as a file
   download.
2. **Given** the same history, **When** the member requests the human-readable document
   format, **Then** a readable document containing the same entries is returned as a
   file download.
3. **Given** a chosen set of filters, **When** the member exports, **Then** the exported
   file contains exactly the entries the equivalent audit query would return — across
   all pages, with no page-size limit applied.
4. **Given** a member who does not hold `audit:export`, **When** they attempt an export,
   **Then** the request is rejected with `FORBIDDEN`.
5. **Given** a request that names a format the system does not support, **When** the
   export is attempted, **Then** the request is rejected with a validation error and no
   file is produced.

---

### User Story 3 - A complete and tamper-proof audit trail (Priority: P1)

Anyone reading the audit log can trust two things absolutely: every state-changing
action in the system produced exactly one audit entry, and once written, no audit entry
can be altered or removed through the application — not by a bug, not by a privileged
user, not by any operation the application itself is capable of performing.

**Why this priority**: A query interface over an incomplete or editable log is worse
than no log at all, because it projects false confidence. The trail's completeness and
immutability are the foundation that makes User Story 1 and User Story 2 meaningful, and
they encode the platform's non-negotiable principles for transactional audit logging and
no hard deletes. This guarantee must hold before the log is exposed for reading.

**Independent Test**: Verifiable directly against the data store without the query
endpoint — exercise every state-changing operation and confirm one entry per operation;
force operations to fail mid-transaction and confirm no entry survives the rollback; and
attempt to update and delete audit records using the application's own data-store
credentials and confirm both are rejected.

**Acceptance Scenarios**:

1. **Given** the full set of state-changing operations across authentication,
   organizations, roles, members, meetings, votes, and minutes, **When** each operation
   is exercised, **Then** exactly one audit entry is written for it, and all 29 defined
   audit event types are observed in the log.
2. **Given** an operation that fails partway through and rolls back, **When** the
   rollback completes, **Then** no audit entry for that operation remains — an audit
   entry never outlives the transaction it describes.
3. **Given** the credentials the application uses to reach its data store, **When** any
   update or delete is attempted against existing audit records, **Then** the operation
   is rejected by the data store itself, not merely by application code.
4. **Given** an audit entry that has already been written, **When** it is later read,
   **Then** its actor, event, entity, payload, and timestamp are identical to the values
   recorded at write time.

---

### User Story 4 - Abuse-resistant authentication and hardened responses (Priority: P2)

The endpoints most exposed to anonymous abuse — account registration, login, and
one-time-code resend — are protected against automated guessing and flooding by an API
gateway that limits how often a single source may call them. The application itself
does not implement rate limiting; it is deployed behind the gateway. Every response the
application returns also instructs browsers to behave defensively, reducing the blast
radius of common web attacks.

**Why this priority**: The system holds organizational governance records and member
credentials; once it is internet-reachable, unauthenticated endpoints are attacked
continuously. Hardening is required before production exposure, but it protects the
existing capabilities rather than adding a new user-facing one, so it ranks below the
audit deliverables.

**Independent Test**: With the system deployed behind its API gateway, call an auth
endpoint repeatedly from a single source past the configured threshold and confirm the
gateway rejects the excess requests with a too-many-requests response while requests
under the threshold succeed; inspect any application response and confirm the defensive
browser headers are present.

**Acceptance Scenarios**:

1. **Given** the registration, login, and code-resend endpoints deployed behind the API
   gateway, **When** a single source exceeds the allowed number of requests within the
   time window, **Then** the gateway rejects further requests from that source within
   the window with a too-many-requests response.
2. **Given** a source that has been rate-limited by the gateway, **When** the time
   window elapses, **Then** the source is able to make requests again — there is no
   permanent lockout.
3. **Given** the gateway's rate-limit configuration, **When** the code-resend limit is
   compared to the registration and login limits, **Then** the code-resend limit is
   stricter.
4. **Given** any request to any endpoint, **When** the response is returned, **Then** it
   carries headers that prevent content-type sniffing and refuse rendering inside a
   frame, and in a production environment also instruct the browser to use encrypted
   connections only.

---

### User Story 5 - Deployable, observable, and documented system (Priority: P3)

An operator can take the system from a blank environment to a running, monitorable
service using only documented steps and documented configuration. The running service
exposes a health signal for load balancers and uptime monitors, refuses to start in a
misconfigured state, and ships with documentation that lets a consumer understand every
endpoint without reading the source.

**Why this priority**: This is the final gate that turns verified functionality into a
production-ready release. It depends on every other story being in place and is the last
slice to be delivered, but it is what makes the difference between "works on a developer
machine" and "deployable."

**Independent Test**: From a clean environment with no prior state, supply the documented
configuration, start the system, and confirm migrations apply automatically and the
health check reports success; then remove a required configuration value and confirm the
system refuses to start rather than running half-configured.

**Acceptance Scenarios**:

1. **Given** a clean environment with no database content and no prior state, **When**
   the system is started with the documented configuration, **Then** all database
   migrations are applied before traffic is accepted and the system becomes fully
   operational.
2. **Given** a running, healthy system, **When** the unauthenticated liveness and
   readiness endpoints are called, **Then** the liveness endpoint reports the process is
   running and the readiness endpoint reports the instance is ready to serve traffic —
   each including a current timestamp and requiring no credentials.
3. **Given** a startup attempt with a required configuration value missing, or with a
   secret value shorter than the minimum allowed length, **When** the system is started,
   **Then** it refuses to start and does not accept any traffic.
4. **Given** the configuration reference shipped with the system, **When** an operator
   reads it, **Then** every configuration variable is listed with its purpose and
   whether it is required or has a default.
5. **Given** the API documentation shipped with the system, **When** a consumer reads
   it, **Then** every endpoint is described with its request shape, its success
   response, every error response it can produce, and the permission it requires.
6. **Given** a running system handling requests and encountering errors, **When** its
   operational logs are inspected, **Then** every log record is structured (JSON) and no
   plain-text log statement appears.

---

### Edge Cases

- An audit query whose start date is later than its end date returns an empty result
  set rather than an error.
- An audit query presented with a malformed page token, or a token issued for a
  different organization, is rejected as an invalid cursor; no entries are leaked.
- An audit query that filters by entity ID without supplying an entity type is
  permitted — it matches that ID across entity types.
- An audit entry whose stored payload contains a field on the redaction deny-list is
  returned by query and export with that field absent, while the stored record retains
  it unchanged.
- An export whose filter set matches zero entries still produces a valid, well-formed
  file (structure and column headers present, no data rows).
- An audit log large enough that loading it entirely into memory would be unsafe is
  still exportable — the export streams its results and completes.
- A request that arrives exactly at the gateway's rate-limit boundary is the last one
  allowed; the next request from the same source within the window is rejected.
- A caller rate-limited by the gateway receives a too-many-requests response and regains
  access once the window resets.
- The system is started while its database is unreachable: the startup migration step
  fails fast and the system does not begin serving requests in a broken state.
- A required secret is present but shorter than the minimum length: it is treated the
  same as a missing value and the system refuses to start.
- When the database is unreachable, the liveness endpoint still reports success (the
  process is alive and should not be restarted) while the readiness endpoint reports
  unhealthy (the instance should not receive traffic).
- A new audit event type is introduced by a future feature: the query and export
  filters accept it without code changes, because event type is a free-form filter
  value rather than a fixed enumeration.

## Requirements _(mandatory)_

### Functional Requirements

#### Audit log query and export

- **FR-501**: System MUST allow a member holding `audit:view` to retrieve their
  organization's audit log entries, ordered newest-first, returned in bounded pages with
  a token for retrieving the next page, consistent with the platform's cursor-pagination
  convention.

- **FR-502**: The audit log query MUST support filtering by actor, event type, entity
  type, entity ID, and a start/end timestamp range. When more than one filter is
  supplied they MUST combine with AND semantics. Supplying no filters MUST return the
  full log, paginated.

- **FR-503**: Every audit log query and every audit log export MUST be scoped to the
  organization identified in the request. An entry belonging to any other organization
  MUST never be returned, regardless of the filter values supplied or the caller's
  memberships in other organizations.

- **FR-504**: Each returned audit entry MUST expose the actor identity, the event type,
  the entity type and entity ID it concerns, the recorded change payload (with sensitive
  fields redacted per FR-504a), and the timestamp at which the action occurred.

- **FR-504a**: Before an audit entry is returned by a query or included in an export,
  its change payload MUST be passed through a read-time redaction step that removes a
  defined deny-list of sensitive fields (such as password hashes, refresh-token hashes,
  and one-time-code hashes). The stored audit record MUST NOT be altered by this step —
  redaction applies only to what the query and export return. The deny-list MUST be a
  single, centrally defined set applied identically by the query path and the export
  path, so that for any filter set the two return identical redacted payloads.

- **FR-505**: System MUST allow a member holding `audit:export` to export the audit log
  as a downloadable file in either a spreadsheet-compatible flat format or a
  human-readable document format. The export MUST contain the complete set of entries
  matching the supplied filters, with no page-size limit applied.

- **FR-506**: The audit export MUST accept the same filter parameters as the audit
  query, and for an identical filter set MUST contain exactly the entries the query
  would return across all of its pages. A request naming an unsupported export format
  MUST be rejected with a validation error.

#### Audit trail integrity

- **FR-507**: The audit log MUST be append-only. The credentials the application uses to
  reach its data store MUST be restricted at the data-store level so that audit entries
  can be inserted but never updated or deleted. Any update or delete attempted through
  the application MUST be rejected by the data store, not merely by application logic.

- **FR-508**: Every state-changing operation across all modules — authentication,
  organizations, roles, members, meetings, votes, and minutes — MUST emit exactly one
  audit entry. All 29 defined audit event types MUST be wired and observable in the log.

- **FR-509**: Every audit entry MUST be written inside the same database transaction as
  the operation it describes. If that transaction rolls back, the audit entry MUST roll
  back with it — no audit entry may describe an operation that did not durably succeed.

#### Security hardening

- **FR-510**: The account-registration, login, and one-time-code-resend endpoints MUST
  be rate-limited at the deployment's API gateway / edge layer, counted per request
  source over a time window, with the code-resend limit stricter than the registration
  and login limits. The application MUST NOT implement rate limiting itself; it is
  deployed behind the gateway, and the gateway's rate-limit configuration is part of the
  production deployment definition.

- **FR-511**: The API gateway MUST reject requests that exceed a rate limit with a
  standard too-many-requests response and MUST resume accepting requests from that
  source once the window elapses. There MUST be no permanent lockout.

- **FR-512**: Every response MUST carry headers that instruct browsers to prevent
  content-type sniffing and to refuse rendering the response inside a frame (clickjacking
  protection). In a production environment, responses MUST also instruct browsers to use
  encrypted (HTTPS) connections only.

#### Deployment readiness

- **FR-513**: System MUST expose two unauthenticated health-check endpoints: a liveness
  endpoint (`/health/live`) that reports whether the service process is up and
  responsive without probing any dependency, and a readiness endpoint (`/health/ready`)
  that additionally verifies the database is reachable and reports whether the instance
  is ready to receive traffic. Each response includes a current timestamp. Load
  balancers and orchestrators use the liveness signal to decide whether to restart an
  instance and the readiness signal to decide whether to route traffic to it.

- **FR-514**: On startup, the system MUST validate that every required configuration
  value is present and MUST refuse to start if any is missing. The system MUST NOT serve
  traffic in a partially configured state.

- **FR-515**: On startup, the system MUST validate that secret configuration values
  (credentials and signing keys) meet a minimum length, and MUST refuse to start if any
  secret is shorter than that minimum.

- **FR-516**: On startup, the system MUST apply all outstanding database migrations
  before it begins accepting traffic. If migrations cannot be applied, the system MUST
  NOT begin serving requests.

- **FR-517**: System MUST be packaged as a self-contained deployable unit that can run
  in a clean environment with no prior state. The running system MUST hold no session
  state in process memory — all session state resides in the database — so that multiple
  instances can run behind a load balancer.

- **FR-518**: Every configuration variable MUST be documented in a configuration
  reference checked into the repository, stating each variable's purpose and whether it
  is required or has a default value.

- **FR-519**: Every endpoint the system exposes MUST be documented with its request
  shape, its success response shape, every error response it can produce, and the
  permission it requires (if any).

- **FR-520**: All production code paths MUST emit operational logs — covering request
  handling and error conditions — as structured (JSON) records; plain-text log
  statements MUST NOT appear in production code paths. Operational logs are distinct
  from the audit log and do not replace it. Operational metrics and distributed-tracing
  infrastructure are out of scope for this feature.

### Key Entities

- **Audit Log Entry**: An immutable, append-only record of a single state-changing
  action. Each entry belongs to one organization and carries the acting member's
  identity, the event type (for example `org.created`), the entity type and entity ID
  the action concerned, a change payload (`{ before, after }` for a mutation or
  `{ data }` for a creation), and the timestamp the action occurred. Entries are created
  inside the transaction of the action they describe and are never modified or deleted
  afterward. A stored payload may contain sensitive fields; because the record is
  immutable, those fields are removed by a read-time redaction step (FR-504a) before any
  query or export returns them — the stored record itself is unchanged. This feature
  reads and exports existing entries; it introduces no new data tables and alters no
  existing columns.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-501**: After the full end-to-end governance flow is exercised, all 29 defined
  audit event types are present in the log — completeness is 100%, with no event type
  missing and no operation producing more than one entry.

- **SC-502**: Across every tested combination of audit query filters, the result set
  contains zero entries that fail to match the filters and zero entries belonging to
  another organization.

- **SC-503**: Paging through an audit log of at least 100,000 entries returns every
  matching entry exactly once — no gaps and no duplicates between consecutive pages.

- **SC-504**: The spreadsheet-compatible export opens as a valid flat file and the
  human-readable export opens as a valid, readable document; for an identical filter
  set, each contains exactly the entries the audit query returns, with no page-size cap
  applied.

- **SC-504a**: Audit entries seeded with deny-list sensitive fields in their payload are
  returned by every query and every export with those fields removed — across all tested
  cases, zero deny-list fields appear in query results or exported files.

- **SC-505**: 100% of attempts to update or delete an existing audit entry through the
  application are rejected by the data store.

- **SC-506**: Under forced mid-transaction failure, 100% of rolled-back operations leave
  zero audit entries behind.

- **SC-507**: With the system deployed behind its API gateway, once an auth endpoint's
  rate limit is reached, 100% of further requests from the same source within the window
  are rejected by the gateway with a too-many-requests response, and 100% of requests
  below the threshold succeed.

- **SC-508**: Every response from every endpoint carries the headers that prevent
  content-type sniffing and clickjacking, and — in a production environment — the header
  that enforces encrypted transport.

- **SC-509**: Both health endpoints require no authentication. The liveness endpoint
  returns a success status in under 100 ms. The readiness endpoint returns a success
  status when the database is reachable and an unhealthy status when it is not.

- **SC-510**: 100% of startup attempts that have a required configuration value missing,
  or a secret value shorter than the minimum length, are rejected before the system
  accepts any traffic.

- **SC-511**: A fully operational system can be brought up from a blank environment with
  no prior state using only the documented configuration and startup steps, with
  database migrations applied automatically.

- **SC-512**: 100% of the endpoints the system exposes are documented with their request
  shape, success and error responses, and required permission.

- **SC-513**: The complete end-to-end governance flow — register, verify, create
  organization, create roles, invite a member, accept the invitation, create a meeting,
  add attendees, open the meeting, create a vote, submit ballots, close the vote,
  complete the meeting, create minutes, attach a resolution, finalize, export, and
  review the audit log — passes without manual intervention.

- **SC-514**: Audit log queries respond within 200 ms at the 95th percentile against an
  organization holding at least 100,000 audit entries, matching the platform-wide
  latency budget.

- **SC-515**: Every operational log record emitted on a production code path is a
  structured (JSON) record — a review of production code paths finds zero plain-text log
  statements.

## Assumptions

- All 17 database tables — including `audit_logs` — were delivered in Phase 0. This
  feature introduces no new tables and alters no existing columns; it reads existing
  audit data and adds the read, export, hardening, and deployment capabilities around
  it.
- The shared audit emitter and the per-request permission guard built in Phase 0 are
  reused without modification. `audit:view` and `audit:export` already exist in the
  fixed 22-key system permission set.
- The 29 audit event types were defined and emitted across Phases 1 through 4. This
  feature verifies their completeness and transactionality and locks the table down at
  the data-store level; it does not introduce new event types.
- Reading the audit log — querying or exporting it — is not itself an audited action.
  There is no `audit.viewed` or `audit.exported` event, consistent with the fixed
  29-event registry.
- Audit entries are retained indefinitely. Consistent with the platform's no-hard-delete
  principle, there is no purge, rotation, or archival of audit data within this feature's
  scope.
- Rate limiting is delegated entirely to the cloud provider's API gateway / edge layer;
  the application never implements it. The exact thresholds and time-window durations
  are gateway configuration chosen during planning. This specification fixes only that
  registration, login, and code-resend are rate-limited at the gateway and that the
  code-resend limit is the strictest. Selecting and configuring the specific cloud API
  gateway is a deployment concern outside this specification.
- The readiness endpoint's dependency probe covers the database connection only; it is
  not extended to fire-and-forget or non-critical external services such as notification
  delivery. The liveness endpoint performs no dependency probe.
- Operational observability in scope for this feature is limited to structured (JSON)
  application logging of request handling and errors. Operational metrics dashboards
  (request rate, latency, error rate) and distributed tracing are out of scope and may
  be added as future work.
- The `from` and `to` audit filters operate on the entry's recorded timestamp; both
  bounds are inclusive; values follow the platform's ISO 8601 UTC convention.
- Audit export delivery streams its results so that an unbounded export does not exhaust
  server memory. The exported file's naming and the document layout of the human-readable
  format are implementation details decided during planning.
- The spreadsheet-compatible format and the human-readable document format are the two
  export formats in scope; any other requested format is rejected.
- The data-store-level append-only restriction applies to the credentials the
  application uses. Database administrators holding elevated, separate privileges are
  outside this control and outside the scope of this feature.
- Containerization targets a single, stateless deployable unit for the MVP.
  Multi-instance orchestration and autoscaling are future work that the stateless design
  enables but that this feature does not deliver.
- The format and hosting of the API documentation are implementation details. The
  requirement is that every endpoint is fully documented; the exact endpoint count is
  confirmed during planning against the assembled route set.
- Cursor pagination for the audit query uses the platform convention established in
  Phase 0 (default page size 20, maximum 100).
- The audit query and export are organization-scoped. There is no cross-organization or
  platform-global audit view within this feature's scope.
- Phases 3 (Meetings) and 4 (Voting & Minutes) are complete before this feature is
  verified end-to-end, since the full governance flow and the 29-event completeness
  check depend on them.
