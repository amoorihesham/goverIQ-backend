import { buildServer } from './server';
import { logger } from './shared/logger';

async function main() {
  const app = await buildServer();

  logger.info('Building server...');

  await app.listen({ port: app.config.PORT, host: app.config.HOST });
}

main().catch((err) => {
  logger.error(err, 'An error occurred while starting the server');
});
