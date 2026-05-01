<!--
  SYNC IMPACT REPORT
  Version change: (template) → 1.0.0
  Added principles:
    - I. Code Quality (new)
    - II. Testing Standards (new)
    - III. API Design Consistency (new — replaces UX Consistency; backend system, no UI)
    - IV. Performance Requirements (new)
  Removed: [PRINCIPLE_5_NAME] slot (user specified 4 principles)
  Added sections:
    - Quality Gates (renamed from [SECTION_2_NAME])
    - Technical Standards (renamed from [SECTION_3_NAME])
  Templates reviewed:
    - .specify/templates/plan-template.md (Constitution Check already generic)
    - .specify/templates/spec-template.md (no principle-specific refs)
    - .specify/templates/tasks-template.md (no principle-specific refs)
  Follow-up TODOs: none
-->

# Groven IQ Constitution

## Core Principles

### I. Code Quality

All code MUST be clean, readable, and maintainable at all times.

- Every function MUST have a single, clearly named responsibility.
- Dead code, commented-out blocks, and unused imports MUST be removed before merge.
- Magic numbers and strings MUST be replaced with named constants or configuration values.
- All code MUST pass the project linter and formatter without warnings before merge.
- Duplication MUST be refactored once a pattern appears three or more times.

### II. Testing Standards

Testing is non-negotiable and drives implementation.

- Tests MUST be written before implementation (TDD: Red → Green → Refactor).
- Unit tests MUST cover all business logic; no business logic may be merged untested.
- Integration tests MUST cover every service boundary and external dependency contract.
- Test coverage MUST not fall below 80% (line coverage); regressions block merge.
- Tests MUST be independently runnable with a single command and MUST NOT produce
  side effects on production or shared external systems.

### III. API Design Consistency

Every service boundary MUST feel like a single, coherent contract.

- All APIs MUST follow a single, project-wide conventions document (REST, RPC, or GraphQL
  — one style per service; mixing styles in one service is prohibited).
- Error responses MUST use a consistent structure across all endpoints
  (status code, machine-readable error code, human-readable message).
- Breaking changes to any public or internal API contract MUST be versioned before release.
- All contracts MUST be documented (OpenAPI or equivalent) and kept up to date with
  the implementation; documentation drift blocks merge.
- Backward-incompatible changes MUST follow a deprecation notice period before removal.

### IV. Performance Requirements

Performance is a feature, not an afterthought.

- API endpoints MUST respond within 200 ms at the 95th percentile under normal load.
- Background jobs MUST NOT block request-handling threads or degrade response times.
- Memory usage MUST NOT grow unboundedly; long-running services MUST be profiled quarterly.
- Database queries MUST use indexes for all filter/sort columns; N+1 query patterns
  are prohibited.
- Performance regressions MUST be caught in CI (via benchmark assertions) before merge.

## Quality Gates

Pull requests MUST pass all of the following before merge:

- All tests pass (unit + integration).
- Linter and formatter report zero warnings.
- Code coverage remains at or above the 80% threshold.
- At least one peer review approval is obtained.
- Constitution Check in the implementation plan is signed off.
- API documentation is up to date if contracts changed.

## Technical Standards

- Dependencies MUST be pinned to exact versions in lockfiles; unpinned ranges are prohibited.
- Third-party libraries MUST be evaluated for active maintenance and license compatibility
  before adoption.
- Secrets and credentials MUST never be committed to the repository; use environment
  variables or a secrets manager.
- Logging MUST use structured JSON output; plain-text log statements are prohibited in
  production code paths.
- All services MUST expose a health-check endpoint that CI and monitoring can probe.

## Governance

This constitution supersedes all other project practices and agreements.
Amendments require:

1. A written proposal describing the change and its rationale.
2. Review and approval by at least two project maintainers.
3. An update to this file with an incremented version number and today's date.
4. Propagation of changes to dependent templates (see Consistency Propagation Checklist).

All pull requests and code reviews MUST include a Constitution Check verifying that no
principle is violated. Violations MUST be justified in the Complexity Tracking table of
the relevant plan.

**Version**: 1.0.0 | **Ratified**: 2026-05-01 | **Last Amended**: 2026-05-01
