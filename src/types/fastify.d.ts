import { Env } from '@/shared/config/env';
import { NotificationDispatcher } from '@/shared/notifications/dispatcher';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    dispatcher: NotificationDispatcher;
  }

  interface FastifyRequest {
    user?: { userId: string; email: string };
    orgMembership?: { roleId: string | null; isOwner: boolean; permissions: string[] };
  }
}
