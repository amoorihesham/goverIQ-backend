import pino from 'pino';

import { buildServer } from './server';

import { validateEnv } from '@/shared/config/env';
import { runMigrations } from '@/shared/database/migrate';

async function main() {
  const envValidation = validateEnv();

  if ('errors' in envValidation) {
    console.error('❌ Environment validation failed:');
    envValidation.errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }

  const env = envValidation.env;
  const logger = pino({ level: env.LOG_LEVEL });

  try {
    logger.info('Running database migrations...');
    await runMigrations();

    logger.info('Building server...');
    const app = await buildServer();

    logger.info(`Starting server on ${env.HOST}:${env.PORT}...`);
    await app.listen({ port: env.PORT, host: env.HOST });

    logger.info(`Server listening at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.error({ err }, 'Fatal error during startup');
    process.exit(1);
  }
}

main();
