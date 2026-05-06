import { Env } from '@/shared/config/env';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }

  interface FastifyRequest {
    user?: { userId: string; email: string };
  }
}
