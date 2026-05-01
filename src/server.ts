import Fastify from 'fastify';
import pino from 'pino';

import { createErrorHandler } from '@/shared/errors/envelope';
import { registerHealthPlugin } from '@/shared/http/plugin';

export async function buildServer() {
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
      },
    },
    serializers: {
      req: (req) => ({
        url: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          authorization: req.headers.authorization ? '[REDACTED]' : undefined,
        },
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    redact: {
      paths: ['req.headers.authorization', '*.password', '*.password_hash', '*.otp', '*.token'],
      remove: true,
    },
  });

  const fastify = Fastify({
    logger,
  });

  fastify.setErrorHandler(createErrorHandler(fastify));

  await fastify.register(registerHealthPlugin);

  return fastify;
}
