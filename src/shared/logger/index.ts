import pino from 'pino';

import { env } from '../config/env';

export const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } },
  level: env.LOG_LEVEL,
});
