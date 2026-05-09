import { FastifyInstance } from 'fastify';
import { memberRoutes } from './member.routes';

export async function membersPlugin(fastify: FastifyInstance) {
  await fastify.register(memberRoutes);
}
