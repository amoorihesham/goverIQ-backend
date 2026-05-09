import { FastifyInstance } from 'fastify';

import { checkHealth } from './health';

export async function registerHealthPlugin(fastify: FastifyInstance) {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'string' },
            },
          },
        },
      },
    },
    (request, reply) => {
      reply.status(200).send({ ok: 'OK' });
    },
  );
  fastify.get('/health/live', (request, reply) => {
    reply.status(200).send({ ok: 'OK' });
  });
  fastify.get('/health/ready', async (request, reply) => {
    const result = await checkHealth();
    reply.status(result.status).send({ ready: result.status === 200 ? true : false });
  });
}
