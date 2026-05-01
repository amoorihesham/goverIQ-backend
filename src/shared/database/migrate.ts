import { migrate } from 'drizzle-orm/neon-http/migrator';

import { logger } from '../logger';

import { DatabaseClient } from './client';

import { AppError } from '@/shared/errors/http-error';

const MIGRATION_LOCK_ID = 5432001;

export async function runMigrations(db: DatabaseClient): Promise<void> {
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
