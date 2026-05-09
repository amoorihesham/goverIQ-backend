import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

import { createDispatcher, type NotificationDispatcher } from './dispatcher';
import { sendNotification } from './service';

export const notificationPlugin = fp(async (app: FastifyInstance) => {
  const dispatcher = createDispatcher(sendNotification);
  app.decorate('dispatcher', dispatcher);
});
