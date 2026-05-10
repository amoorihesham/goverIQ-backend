import { FastifyInstance } from 'fastify';

import { buildApp } from './app';
import { env } from './shared/config/env';
import { db, pool } from './shared/database/client';
import { runMigrations } from './shared/database/migrate';
import { logger } from './shared/logger';

let isShuttingDown = false;

async function main() {
  logger.info('Initializing Database Connection...');

  logger.info('Running database migrations...');
  await runMigrations(db);

  logger.info('Building server...');
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: env.HOST });

  process.on('SIGINT', (signal) => shutdown(signal, app));
  process.on('SIGTERM', (signal) => shutdown(signal, app));
}

main().catch((err) => {
  logger.error(err, 'An error occurred while starting the server');
});

async function shutdown(signal: string, app: FastifyInstance) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Shutdown Signal Received.');

  const timeoutId = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, 30000);

  try {
    await app.close();
    await pool.end();
    clearTimeout(timeoutId);
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Shutdown Failed.');
    process.exit(1);
  }
}
