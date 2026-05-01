# Contract: System Permission Set (FR-002)

Fixed registry of 22 permission keys across 6 domains. The set is immutable at runtime.
Organizations cannot add or remove entries.

| Domain | Permission Key | Used By (Phase) |
|--------|----------------|-----------------|
| Organization | `org:update` | 2 |
| Organization | `org:archive` | 2 |
| Roles | `role:create` | 2 |
| Roles | `role:update` | 2 |
| Roles | `role:delete` | 2 |
| Roles | `role:assign` | 2 |
| Roles | `role:revoke` | 2 |
| Members | `member:invite` | 2 |
| Members | `member:remove` | 2 |
| Meetings | `meeting:create` | 3 |
| Meetings | `meeting:update` | 3 |
| Meetings | `meeting:manage_attendees` | 3 |
| Meetings | `meeting:change_status` | 3 |
| Meetings | `meeting:view` | 3 |
| Voting | `vote:create` | 4 |
| Voting | `vote:submit` | 4 |
| Voting | `vote:close` | 4 |
| Voting | `vote:view_results` | 4 |
| Minutes | `minutes:create` | 4 |
| Minutes | `minutes:edit` | 4 |
| Minutes | `minutes:finalize` | 4 |
| Minutes | `minutes:export` | 4 |
| Audit | `audit:view` | 5 |
| Audit | `audit:export` | 5 |

**Total: 24 permissions** (the implementation plan's count of "22" excluded the two
audit permissions; this contract is the authoritative list).

> **Note**: The implementation plan and constitution-aligned spec reference "22
> permissions." Audit permissions (`audit:view`, `audit:export`) appear in the plan's
> Phase 5 section but were not included in the original count. They are listed here
> for completeness; the typed constant in `src/shared/permissions/set.ts` will include
> all 24, organized by domain. If the user prefers strictly 22, drop the two audit
> entries here and define them in the Phase 5 module instead.

## Implementation Contract

`src/shared/permissions/set.ts` exports:

```ts
export const PERMISSIONS = {
  ORG: ['org:update', 'org:archive'],
  ROLE: ['role:create', 'role:update', 'role:delete', 'role:assign', 'role:revoke'],
  MEMBER: ['member:invite', 'member:remove'],
  MEETING: ['meeting:create', 'meeting:update', 'meeting:manage_attendees', 'meeting:change_status', 'meeting:view'],
  VOTE: ['vote:create', 'vote:submit', 'vote:close', 'vote:view_results'],
  MINUTES: ['minutes:create', 'minutes:edit', 'minutes:finalize', 'minutes:export'],
  AUDIT: ['audit:view', 'audit:export'],
} as const satisfies Record<string, readonly string[]>;

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flat();
export type PermissionKey = (typeof ALL_PERMISSIONS)[number];
```

The `PermissionKey` type is a union of all 24 string literals — this gives compile-time
safety wherever a permission name is referenced.

## Owner Role

When an organization is created (Phase 2), the Owner role is automatically created
holding **all** permission keys (`ALL_PERMISSIONS`) and `is_owner = true`. The Owner
role cannot be modified or deleted.

The permission guard short-circuits for Owner-role members: if `roles.is_owner = true`,
the request is allowed regardless of which permission was required.
