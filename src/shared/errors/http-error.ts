import { ERROR_CODES, type ErrorCode } from './codes';

export class AppError extends Error {
  code: ErrorCode;
  statusCode: number;
  message: string;

  constructor(code: ErrorCode, statusCode: number, message: string) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.message = message;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static create(code: ErrorCode, message?: string): AppError {
    const errorDef = ERROR_CODES[code];
    const msg = message || errorDef.message;
    return new AppError(code, errorDef.httpStatus, msg);
  }

  static validationError(message?: string): AppError {
    return AppError.create('VALIDATION_ERROR', message);
  }

  static unauthorized(message?: string): AppError {
    return AppError.create('UNAUTHORIZED', message);
  }

  static forbidden(message?: string): AppError {
    return AppError.create('FORBIDDEN', message);
  }

  static notFound(message?: string): AppError {
    return AppError.create('NOT_FOUND', message);
  }

  static conflict(message?: string): AppError {
    return AppError.create('CONFLICT', message);
  }

  static internalError(message?: string): AppError {
    return AppError.create('INTERNAL_ERROR', message);
  }

  static duplicateEmail(message?: string): AppError {
    return AppError.create('DUPLICATE_EMAIL', message);
  }

  static duplicateOrgName(message?: string): AppError {
    return AppError.create('DUPLICATE_ORG_NAME', message);
  }

  static pendingInviteExists(message?: string): AppError {
    return AppError.create('PENDING_INVITE_EXISTS', message);
  }

  static invalidCredentials(message?: string): AppError {
    return AppError.create('INVALID_CREDENTIALS', message);
  }

  static tokenExpired(message?: string): AppError {
    return AppError.create('TOKEN_EXPIRED', message);
  }

  static invalidToken(message?: string): AppError {
    return AppError.create('INVALID_TOKEN', message);
  }

  static duplicateBallot(message?: string): AppError {
    return AppError.create('DUPLICATE_BALLOT', message);
  }

  static meetingHasOpenVotes(message?: string): AppError {
    return AppError.create('MEETING_HAS_OPEN_VOTES', message);
  }

  static quorumNotMet(message?: string): AppError {
    return AppError.create('QUORUM_NOT_MET', message);
  }

  static orgArchived(message?: string): AppError {
    return AppError.create('ORG_ARCHIVED', message);
  }

  static migrationLockFailed(message?: string): AppError {
    return AppError.create('MIGRATION_LOCK_FAILED', message);
  }

  static otpExpired(message?: string): AppError {
    return AppError.create('OTP_EXPIRED', message);
  }

  static otpCooldown(message?: string): AppError {
    return AppError.create('OTP_COOLDOWN', message);
  }

  static privilegeEscalation(message?: string): AppError {
    return AppError.create('PRIVILEGE_ESCALATION', message);
  }

  static roleInUse(message?: string): AppError {
    return AppError.create('ROLE_IN_USE', message);
  }

  static soleOwner(message?: string): AppError {
    return AppError.create('SOLE_OWNER', message);
  }

  static invalidStateTransition(message?: string): AppError {
    return AppError.create('INVALID_STATE_TRANSITION', message);
  }

  static meetingTooEarly(message?: string): AppError {
    return AppError.create('MEETING_TOO_EARLY', message);
  }

  static voteClosed(message?: string): AppError {
    return AppError.create('VOTE_CLOSED', message);
  }

  static minutesFinalized(message?: string): AppError {
    return AppError.create('MINUTES_FINALIZED', message);
  }
}
