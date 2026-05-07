import { buildApp } from './app';
import { env } from './shared/config/env';
import { db } from './shared/database/client';
import { runMigrations } from './shared/database/migrate';
import { logger } from './shared/logger';

async function main() {
  logger.info('Initializing Database Connection...');

  logger.info('Running database migrations...');
  await runMigrations(db);

  logger.info('Building server...');
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  logger.error(err, 'An error occurred while starting the server');
});
