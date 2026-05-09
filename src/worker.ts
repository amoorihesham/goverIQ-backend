import { logger } from '@/shared/logger';
import { db, pool } from '@/shared/database/client';
import type { NotificationTemplate } from '@/shared/notifications/dispatcher';
import { closeConnection, createWorker, getRedisConnection } from './shared/queue/bullmq';
import { sendNotification } from './shared/notifications/service';
import { Queue } from 'bullmq';
import { cleanupOtpsJob } from './shared/queue/jobs/cleanup-otps';
import { expireInvitesJob } from './shared/queue/jobs/expire-invites';
import { cleanupRefreshJob } from './shared/queue/jobs/cleanup-refresh';
import { EmailVerificationPayload } from './shared/notifications/templates/email-verification';
import { InvitationPayload } from './shared/notifications/templates/invitation';

async function main() {
  logger.info('Worker starting');

  const notifWorker = createWorker<{
    template: NotificationTemplate;
    to: string;
    data: EmailVerificationPayload | InvitationPayload;
  }>('notifications', async (job) => {
    const { template, to, data } = job.data;
    await sendNotification(template, to, data);
  });

  const systemQueue = new Queue('system', { connection: getRedisConnection() });
  await systemQueue.add('cleanup-otps', {}, { repeat: { every: 10 * 60 * 1000 } });
  await systemQueue.add('expire-invites', {}, { repeat: { every: 60 * 60 * 1000 } });
  await systemQueue.add('cleanup-refresh', {}, { repeat: { pattern: '0 3 * * *' } });

  const systemWorker = createWorker('system', async (job) => {
    if (job.name === 'cleanup-otps') return cleanupOtpsJob(db);
    if (job.name === 'expire-invites') return expireInvitesJob(db);
    if (job.name === 'cleanup-refresh') return cleanupRefreshJob(db);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutdown signal received');
    try {
      await notifWorker.close();
      await systemWorker.close();
      await systemQueue.close();
      await closeConnection();
      await pool.end();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Worker shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Worker ready');
}

main().catch((err) => {
  logger.error({ err }, 'Worker fatal error');
  process.exit(1);
});
