import { Env } from '@/shared/config/env';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }
}
