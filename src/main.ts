import { buildServer } from './server';
import { runMigrations } from '@/shared/database/migrate';
import pino from 'pino';

const logger = pino();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  try {
    logger.info('Running database migrations...');
    await runMigrations();

    logger.info('Building server...');
    const app = await buildServer();

    logger.info(`Starting server on ${HOST}:${PORT}...`);
    await app.listen({ port: PORT, host: HOST });

    logger.info(`Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    logger.error({ err }, 'Fatal error during startup');
    process.exit(1);
  }
}

main();
