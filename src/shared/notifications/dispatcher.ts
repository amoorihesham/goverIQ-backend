import { logger } from '@/shared/logger';
import { EmailVerificationPayload } from './templates/email-verification';
import { InvitationPayload } from './templates/invitation';

export type NotificationTemplate = 'email-verification' | 'invitation';

export interface EnqueueOptions {
  reqId?: string;
  jobId?: string;
}

export interface NotificationDispatcher {
  enqueue(
    template: NotificationTemplate,
    to: string,
    data: EmailVerificationPayload | InvitationPayload,
    opts?: EnqueueOptions,
  ): Promise<void>;
}

export class InProcessDispatcher implements NotificationDispatcher {
  constructor(
    private readonly handler: (
      template: NotificationTemplate,
      to: string,
      data: EmailVerificationPayload | InvitationPayload,
    ) => Promise<void>,
  ) {}

  async enqueue(
    template: NotificationTemplate,
    to: string,
    data: EmailVerificationPayload | InvitationPayload,
  ): Promise<void> {
    setImmediate(() => {
      this.handler(template, to, data).catch((err) =>
        logger.error({ err, template }, 'InProcessDispatcher: handler failed'),
      );
    });
  }
}

export class BullMQDispatcher implements NotificationDispatcher {
  private queue: import('bullmq').Queue;

  constructor(queue: import('bullmq').Queue) {
    this.queue = queue;
  }

  async enqueue(
    template: NotificationTemplate,
    to: string,
    data: EmailVerificationPayload | InvitationPayload,
    opts: EnqueueOptions = {},
  ): Promise<void> {
    await this.queue.add(
      template,
      { template, to, data },
      {
        jobId: opts.jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86_400 },
      },
    );
  }
}

export function createDispatcher(
  notifHandler: (
    template: NotificationTemplate,
    to: string,
    data: EmailVerificationPayload | InvitationPayload,
  ) => Promise<void>,
): NotificationDispatcher {
  const { env } = require('@/shared/config/env');
  if (env.QUEUE_BACKEND === 'redis' && env.REDIS_URL) {
    const { Queue } = require('bullmq');
    const IORedis = require('ioredis').default ?? require('ioredis');
    const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue('notifications', { connection });
    return new BullMQDispatcher(queue);
  }
  return new InProcessDispatcher(notifHandler);
}
