import { lt } from 'drizzle-orm';
import { emailVerifications } from '@/db/schema/auth';
import { emitAudit } from '@/shared/audit/emitter';
import type { DatabaseClient } from '@/shared/database/types';
import { withTx } from '@/shared/database/transaction';

export async function cleanupOtpsJob(db: DatabaseClient): Promise<void> {
  await withTx(async (tx) => {
    const result = await tx
      .delete(emailVerifications)
      .where(lt(emailVerifications.expiresAt, new Date()))
      .returning({ id: emailVerifications.id });

    await emitAudit(tx, {
      event: 'system.cleanup',
      entityType: 'emailVerification',
      entityId: null,
      actorId: null,
      orgId: null,
      payload: { job: 'cleanup-otps', deletedCount: result.length },
    });
  });
}
