import { buildServer } from './server';
import { createDatabaseClient } from './shared/database/client';
import { logger } from './shared/logger';

import { runMigrations } from '@/shared/database/migrate';

async function main() {
  const app = await buildServer();

  logger.info('Initializing Database Connection...');
  const db = createDatabaseClient(app.config.DATABASE_URL);

  logger.info('Running database migrations...');
  await runMigrations(db);

  logger.info('Building server...');

  await app.listen({ port: app.config.PORT, host: '127.0.0.1' });
}

main();
