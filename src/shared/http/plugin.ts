import { FastifyInstance } from 'fastify';
import { checkHealth } from './health';
import { z } from 'zod';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
});

export async function registerHealthPlugin(fastify: FastifyInstance) {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  timestamp: { type: 'string' },
                },
              },
            },
          },
          503: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  statusCode: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await checkHealth();
      reply.status(result.status as 200 | 503).send(result.data);
    },
  );
}
