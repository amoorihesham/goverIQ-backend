import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createDispatcher } from './dispatcher';

export const notificationPlugin = fp(async (app: FastifyInstance) => {
  const dispatcher = await createDispatcher();
  app.decorate('dispatcher', dispatcher);
});
