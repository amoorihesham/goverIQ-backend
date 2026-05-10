import { and, eq, lt } from 'drizzle-orm';

import { invitations } from '@/db/schema/org';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';

export async function expireInvitesJob(): Promise<void> {
  await withTx(async (tx) => {
    const result = await tx
      .update(invitations)
      .set({ status: 'EXPIRED' })
      .where(and(eq(invitations.status, 'PENDING'), lt(invitations.expiresAt, new Date())))
      .returning({ id: invitations.id });

    await emitAudit(tx, {
      event: 'system.cleanup',
      entityType: 'invitation',
      entityId: null,
      actorId: null,
      orgId: null,
      payload: { job: 'expire-invites', expiredCount: result.length },
    });
  });
}
