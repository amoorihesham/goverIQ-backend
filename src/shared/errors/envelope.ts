import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';

import { AppError } from './http-error';
import { reportError } from './reporter';

import { getConstraintName, isUniqueViolation } from '@/shared/database/errors';
import { trace } from '@opentelemetry/api';
import jwt from 'jsonwebtoken';

type LoggerHolder = {
  log: Logger;
};

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

const FASTIFY_CLIENT_ERROR_CODES = new Set([
  'FST_ERR_CTP_EMPTY_JSON_BODY',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE',
  'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
]);

function isFastifyError(err: FastifyError | Error) {
  return FASTIFY_CLIENT_ERROR_CODES.has((err as FastifyError).code);
}
function isValidationError(err: FastifyError | Error) {
  return (err as FastifyError).validation && Array.isArray((err as FastifyError).validation);
}

const UNIQUE_CONSTRAINT_MAP: Record<string, () => AppError> = {
  users_email_idx: () => AppError.duplicateEmail(),
};

export function createErrorHandler(fastify: LoggerHolder) {
  return async (err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(failure(err));
    }

    if (isValidationError(err)) {
      const appErr = AppError.validationError(err.message);
      return reply.status(appErr.statusCode).send(failure(appErr));
    }

    if (isFastifyError(err)) {
      const appErr = AppError.validationError(err.message);
      return reply.status(appErr.statusCode).send(failure(appErr));
    }

    if (isUniqueViolation(err)) {
      const constraint = getConstraintName(err);
      const factory = constraint ? UNIQUE_CONSTRAINT_MAP[constraint] : undefined;
      const appErr = factory?.() ?? AppError.conflict();
      return reply.status(appErr.statusCode).send(failure(appErr));
    }

    if (err instanceof jwt.JsonWebTokenError) {
      if (err.message === 'jwt expired') {
        const appErr = AppError.create('INVALID_TOKEN');
        reply.status(appErr.statusCode).send(failure(appErr));
      } else if (err.message === 'invalid signature') {
        const appErr = AppError.create('INVALID_TOKEN');
        reply.status(appErr.statusCode).send(failure(appErr));
      }
    }

    const span = trace.getActiveSpan();
    reportError(err, {
      reqId: request.id,
      userId: request.user?.userId,
      orgId: request.orgId,
    });

    fastify.log.error({ err, traceId: span?.spanContext().traceId }, 'Unhandled error');
    return reply.status(500).send(failure(AppError.internalError()));
  };
}
