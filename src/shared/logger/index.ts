import pino from 'pino';

import { env } from '../config/env';

const isProduction = env.NODE_ENV === 'production';

export const logger = pino({
  redact: {
    paths: [
      'password',
      'passwordHash',
      'otpHash',
      'tokenHash',
      'refreshTokenCleartext',
      'accessToken',
      '*.Authorization',
      'cookie',
      'set-cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    remove: false,
    censor: '[REDACTED]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      }),
  level: env.LOG_LEVEL,
});
