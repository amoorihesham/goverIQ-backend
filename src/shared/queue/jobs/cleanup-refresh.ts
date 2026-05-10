import { lt } from 'drizzle-orm';

import { refreshTokens } from '@/db/schema/auth';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';

export async function cleanupRefreshJob(): Promise<void> {
  await withTx(async (tx) => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await tx
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, cutoff))
      .returning({ id: refreshTokens.id });

    await emitAudit(tx, {
      event: 'system.cleanup',
      entityType: 'refreshToken',
      entityId: null,
      actorId: null,
      orgId: null,
      payload: { job: 'cleanup-refresh', deletedCount: result.length },
    });
  });
}
