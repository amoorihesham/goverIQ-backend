export const PERMISSIONS = {
  ORG: ['org:read', 'org:update', 'org:archive'] as const,
  ROLE: ['role:create', 'role:read', 'role:update', 'role:delete'] as const,
  MEMBER: ['member:read', 'member:invite', 'member:remove', 'member:update_role'] as const,
  MEETING: ['meeting:create', 'meeting:read', 'meeting:update', 'meeting:cancel', 'meeting:delete'] as const,
  VOTE: ['vote:create', 'vote:read', 'vote:open', 'vote:close', 'vote:cast_ballot'] as const,
  MINUTES: ['minutes:create', 'minutes:read', 'minutes:update', 'minutes:finalize'] as const,
  INVITATION: ['invitation:create', 'invitation:read', 'invitation:update', 'invitation:delete'] as const,
  AUDIT: ['audit:view', 'audit:export'] as const,
} as const satisfies Record<string, readonly string[]>;

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flat();

export type PermissionKey = (typeof ALL_PERMISSIONS)[number];

Object.freeze(PERMISSIONS);
Object.freeze(ALL_PERMISSIONS);
