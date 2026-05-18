import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '@/shared/audit/events';
import { db } from '@/shared/database/client';
import { auditLogs } from '@/db/schema/audit';

import { truncateAllTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { setupAuditContext } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await app.close();
});

describe('Audit Integrity (FR-507..509)', () => {
  it('rejects UPDATE on audit_logs (append-only trigger)', async () => {
    await expect(db.execute(`UPDATE audit_logs SET event = 'tampered' WHERE 1=0`)).rejects.toThrow(/append-only/i);
  });

  it('rejects DELETE on audit_logs (append-only trigger)', async () => {
    await expect(db.execute(`DELETE FROM audit_logs WHERE 1=0`)).rejects.toThrow(/append-only/i);
  });

  it('audit rows are NOT created when a transaction rolls back (FR-509)', async () => {
    const { orgId, user } = await setupAuditContext(app);
    const beforeCount = await db
      .select()
      .from(auditLogs)
      .then((r) => r.length);

    try {
      await db.transaction(async (tx) => {
        const { emitAudit } = await import('@/shared/audit/emitter');
        await emitAudit(tx, {
          orgId,
          actorId: user.id,
          event: 'meeting.created',
          entityType: 'meeting',
          entityId: null,
          payload: { data: {} },
        });
        throw new Error('forced rollback');
      });
    } catch {
      // expected
    }

    const afterCount = await db
      .select()
      .from(auditLogs)
      .then((r) => r.length);
    expect(afterCount).toBe(beforeCount);
  });
});

describe('Audit Event Registry Completeness (FR-508, SC-501)', () => {
  it('AUDIT_EVENTS contains exactly 29 distinct entries', () => {
    expect(AUDIT_EVENTS.length).toBe(29);
    const unique = new Set(AUDIT_EVENTS);
    expect(unique.size).toBe(29);
  });
});
