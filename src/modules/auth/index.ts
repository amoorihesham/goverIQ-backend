import type { FastifyInstance } from 'fastify';

import { authRoutes } from './auth.routes';

export async function authPlugin(fastify: FastifyInstance) {
  await fastify.register(authRoutes);
}
