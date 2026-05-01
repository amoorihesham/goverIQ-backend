import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

export async function createTestServer(): Promise<{
  app: FastifyInstance;
  inject: FastifyInstance['inject'];
}> {
  const app = Fastify({
    logger: false,
  });

  return {
    app,
    inject: app.inject.bind(app),
  };
}
