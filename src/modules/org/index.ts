import type { FastifyInstance } from 'fastify';

import { orgRoutes } from './org.routes';

export async function orgPlugin(fastify: FastifyInstance) {
  await fastify.register(orgRoutes);
}
