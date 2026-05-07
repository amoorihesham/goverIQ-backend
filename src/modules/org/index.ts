import type { FastifyInstance } from 'fastify';

import { orgRoutes } from './org.routes';
import { roleRoutes } from './role.routes';

export async function orgPlugin(fastify: FastifyInstance) {
  await fastify.register(orgRoutes);
  await fastify.register(roleRoutes);
}

// Placeholder for Phase 6 (invitation public endpoints)
export async function invitationsPublicPlugin(fastify: FastifyInstance) {
  // TODO: Register public invitation accept/decline routes
}
