import { Env } from '@/shared/config/env';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }

  interface FastifyRequest {
    user?: { userId: string; email: string };
    orgId: string;
    orgMembership?: { roleId: string | null; isOwner: boolean; permissions: string[] };
  }
}
