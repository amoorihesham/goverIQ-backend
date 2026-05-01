# Contract: Error Code Registry (FR-008)

Fixed registry of machine-readable error codes used across the entire system. No
domain module may introduce ad-hoc error codes outside this set. New codes require a
constitution amendment-equivalent update to this file before use.

| Code                       | HTTP | Phase | Meaning                                                                                         |
| -------------------------- | ---- | ----- | ----------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`             | 401  | 1     | Missing, invalid, or expired access credential                                                  |
| `FORBIDDEN`                | 403  | 0     | Authenticated but lacks required permission, or target org does not exist (Q2 clarification)    |
| `NOT_FOUND`                | 404  | 1     | Resource does not exist (used only when identity-leak is acceptable, e.g. self-owned resources) |
| `CONFLICT`                 | 409  | 2     | Duplicate resource or invalid state                                                             |
| `INVALID_STATE_TRANSITION` | 422  | 3     | State machine violation                                                                         |
| `MEETING_TOO_EARLY`        | 422  | 3     | Opening a meeting more than 15 min before scheduled time                                        |
| `MEETING_HAS_OPEN_VOTES`   | 422  | 4     | Completing a meeting while votes remain `OPEN`                                                  |
| `VOTE_CLOSED`              | 422  | 4     | Submitting a ballot to a closed vote                                                            |
| `DUPLICATE_BALLOT`         | 409  | 4     | Member has already voted on this vote                                                           |
| `MINUTES_FINALIZED`        | 422  | 4     | Editing minutes that have been finalized                                                        |
| `OTP_EXPIRED`              | 422  | 1     | Submitted OTP has expired                                                                       |
| `OTP_COOLDOWN`             | 422  | 1     | OTP resend requested within cooldown window                                                     |
| `PRIVILEGE_ESCALATION`     | 403  | 2     | Caller attempted to grant permissions exceeding their own                                       |
| `ROLE_IN_USE`              | 409  | 2     | Cannot delete a role with active memberships                                                    |
| `SOLE_OWNER`               | 409  | 2     | Cannot remove the only Owner of an organization                                                 |
| `PENDING_INVITE_EXISTS`    | 409  | 2     | Duplicate pending invitation for the same email + org                                           |
| `INTERNAL_ERROR`           | 500  | 0     | Unexpected server error (catch-all; never surfaces internal details)                            |

## Implementation Contract

`src/shared/errors/codes.ts` exports:

```ts
export const ERROR_CODES = {
  UNAUTHORIZED: { http: 401 },
  FORBIDDEN: { http: 403 },
  // ...etc
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
```

`src/shared/errors/http-error.ts` exports `class HttpError extends Error` with
`code: ErrorCode`, `statusCode: number`, `message: string`. Domain modules throw
`HttpError` instances; the global Fastify error handler converts them to the response
envelope (see [response-envelope.md](./response-envelope.md)).

## Phase 0 Scope

Phase 0 wires the registry and the error-to-envelope mapping. Only `INTERNAL_ERROR`
and `FORBIDDEN` (used by the permission guard) are actively raised in Phase 0. The
other codes are defined for use by later phases.
