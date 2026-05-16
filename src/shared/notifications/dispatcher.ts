import { env } from '../config/env';

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

export async function createDispatcher(): Promise<NotificationDispatcher> {
  const { Queue } = await import('bullmq');
  const IORedis = (await import('ioredis')).Redis ?? import('ioredis');
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('notifications', { connection });
  return new BullMQDispatcher(queue);
}
