import { FastifyError, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { AppError } from './http-error';

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

export function createErrorHandler(fastify: FastifyInstance) {
  return async (err: FastifyError | Error, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(failure(err));
    }

    if (isValidationError(err)) {
      const appErr = AppError.validationError(err.message);
      return reply.status(appErr.statusCode).send(failure(appErr));
    }

    const internalError = AppError.internalError();
    fastify.log.error({ err }, 'Unhandled error');
    return reply.status(internalError.statusCode).send(failure(internalError));
  };
}
