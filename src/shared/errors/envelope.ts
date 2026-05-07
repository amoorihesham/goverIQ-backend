import { FastifyError, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { AppError } from './http-error';

import { getConstraintName, isUniqueViolation } from '@/shared/database/errors';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface FailureEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
  };
}

export type ResponseEnvelope<T> = SuccessEnvelope<T> | FailureEnvelope;

export function success<T>(data: T): SuccessEnvelope<T> {
  return {
    success: true,
    data,
  };
}

export function failure(err: AppError): FailureEnvelope {
  return {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
    },
  };
}

function isValidationError(err: FastifyError | Error): err is FastifyError {
  return (
    typeof (err as FastifyError).validation !== 'undefined' &&
    Array.isArray((err as FastifyError).validation)
  );
}

// Maps PostgreSQL unique-constraint names to domain errors.
// Add an entry here whenever a new unique index is added to the schema.
const UNIQUE_CONSTRAINT_MAP: Record<string, () => AppError> = {
  users_email_idx: () => AppError.duplicateEmail(),
};

export function createErrorHandler(fastify: FastifyInstance) {
  return async (err: FastifyError | Error, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(failure(err));
    }

    if (isValidationError(err)) {
      const appErr = AppError.validationError(err.message);
      return reply.status(appErr.statusCode).send(failure(appErr));
    }

    if (isUniqueViolation(err)) {
      const constraint = getConstraintName(err);
      const factory = constraint ? UNIQUE_CONSTRAINT_MAP[constraint] : undefined;
      const appErr = factory?.() ?? AppError.conflict();
      return reply.status(appErr.statusCode).send(failure(appErr));
    }

    fastify.log.error({ err }, 'Unhandled error');
    return reply.status(500).send(failure(AppError.internalError()));
  };
}
