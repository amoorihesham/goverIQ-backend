import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createDispatcher } from './dispatcher';
import { sendNotification } from './service';

export const notificationPlugin = fp(async (app: FastifyInstance) => {
  const dispatcher = await createDispatcher(sendNotification);
  app.decorate('dispatcher', dispatcher);
});
