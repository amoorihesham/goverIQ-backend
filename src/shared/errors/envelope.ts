import { FastifyError, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from './http-error';
import { ERROR_CODES } from './codes';

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

export function createErrorHandler(fastify: FastifyInstance) {
  return async (err: FastifyError | Error, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(failure(err));
    }

    const internalError = AppError.internalError();
    fastify.log.error({ err }, 'Unhandled error');
    return reply.status(internalError.statusCode).send(failure(internalError));
  };
}
