import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { identityRequired } from '../auth/identity';

import { checkHealth } from './health';

export async function registerHealthPlugin(fastify: FastifyInstance) {
  fastify.get(
    '/health/live',
    { schema: { summary: 'Test the live server is live and running.' } },
    (request, reply) => {
      reply.status(200).send({ ok: 'OK' });
    },
  );
  fastify.get(
    '/health/ready',
    { schema: { summary: 'Test the server is live and ready to accept connections.' } },
    async (request, reply) => {
      const result = await checkHealth();
      reply.status(result.status).send({ ready: result.status === 200 ? true : false });
    },
  );
  fastify.get(
    '/protected',
    { preHandler: [identityRequired] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.status(200).send({ user: { userId: request.user?.userId, email: request.user?.email } });
    },
  );
}
