import { FastifyInstance } from 'fastify';

import { checkHealth } from './health';

export async function registerHealthPlugin(fastify: FastifyInstance) {
  fastify.get(
    '/health/live',
    { schema: { summary: 'Liveness probe — returns 200 with no dependency check', tags: ['Health'] } },
    (_request, reply) => {
      reply.status(200).send({ status: 'live', timestamp: new Date().toISOString() });
    },
  );

  fastify.get(
    '/health/ready',
    { schema: { summary: 'Readiness probe — returns 200 when DB is reachable, 503 otherwise', tags: ['Health'] } },
    async (_request, reply) => {
      const result = await checkHealth();
      const status = result.status === 200 ? 'ready' : 'unavailable';
      reply.status(result.status === 200 ? 200 : 503).send({ status, timestamp: new Date().toISOString() });
    },
  );
}
