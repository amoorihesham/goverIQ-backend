export const ERROR_CODES = {
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    httpStatus: 400,
    message: 'Validation failed',
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    httpStatus: 401,
    message: 'Unauthorized',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    httpStatus: 403,
    message: 'Forbidden',
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    httpStatus: 404,
    message: 'Not found',
  },
  CONFLICT: {
    code: 'CONFLICT',
    httpStatus: 409,
    message: 'Conflict',
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    httpStatus: 500,
    message: 'Internal server error',
  },
  DUPLICATE_EMAIL: {
    code: 'DUPLICATE_EMAIL',
    httpStatus: 409,
    message: 'Email already exists',
  },
  DUPLICATE_ORG_NAME: {
    code: 'DUPLICATE_ORG_NAME',
    httpStatus: 409,
    message: 'Organization name already exists',
  },
  PENDING_INVITE_EXISTS: {
    code: 'PENDING_INVITE_EXISTS',
    httpStatus: 409,
    message: 'Pending invitation already exists',
  },
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    httpStatus: 401,
    message: 'Invalid credentials',
  },
  TOKEN_EXPIRED: {
    code: 'TOKEN_EXPIRED',
    httpStatus: 401,
    message: 'Token expired',
  },
  INVALID_TOKEN: {
    code: 'INVALID_TOKEN',
    httpStatus: 401,
    message: 'Invalid token',
  },
  DUPLICATE_BALLOT: {
    code: 'DUPLICATE_BALLOT',
    httpStatus: 409,
    message: 'Ballot already exists',
  },
  MEETING_HAS_OPEN_VOTES: {
    code: 'MEETING_HAS_OPEN_VOTES',
    httpStatus: 409,
    message: 'Meeting has open votes',
  },
  QUORUM_NOT_MET: {
    code: 'QUORUM_NOT_MET',
    httpStatus: 409,
    message: 'Quorum not met',
  },
  ORG_ARCHIVED: {
    code: 'ORG_ARCHIVED',
    httpStatus: 409,
    message: 'Organization is archived',
  },
  MIGRATION_LOCK_FAILED: {
    code: 'MIGRATION_LOCK_FAILED',
    httpStatus: 500,
    message: 'Failed to acquire migration lock',
  },
  OTP_EXPIRED: {
    code: 'OTP_EXPIRED',
    httpStatus: 422,
    message: 'Verification code has expired',
  },
  OTP_COOLDOWN: {
    code: 'OTP_COOLDOWN',
    httpStatus: 422,
    message: 'Please wait before requesting another code',
  },
  PRIVILEGE_ESCALATION: {
    code: 'PRIVILEGE_ESCALATION',
    httpStatus: 403,
    message: 'Privilege escalation not permitted',
  },
  ROLE_IN_USE: {
    code: 'ROLE_IN_USE',
    httpStatus: 409,
    message: 'Role is assigned to one or more members',
  },
  SOLE_OWNER: {
    code: 'SOLE_OWNER',
    httpStatus: 409,
    message: 'Cannot remove the sole owner of an organization',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
