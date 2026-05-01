import { migrate } from 'drizzle-orm/neon-http/migrator';
import { db } from './client';
import { AppError } from '@/shared/errors/http-error';
import pino from 'pino';

const logger = pino();

const MIGRATION_LOCK_ID = 5432001;
const LOCK_TIMEOUT_MS = 30000;

export async function runMigrations(): Promise<void> {
  try {
    logger.info('Acquiring migration advisory lock...');

    await db.execute(`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`);
    logger.info('Acquired migration advisory lock');

    logger.info('Running migrations...');
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    logger.info('Migrations completed successfully');

    logger.info('Releasing migration advisory lock');
    await db.execute(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
    logger.info('Released migration advisory lock');
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    if (err instanceof AppError) {
      throw err;
    }
    throw AppError.migrationLockFailed('Failed to complete migrations');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      logger.info('Migration runner completed');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration runner failed');
      process.exit(1);
    });
}
