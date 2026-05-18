import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/shared/database/client';
import { auditLogs } from '@/db/schema/audit';
import { AUDIT_REDACTION_DENYLIST } from '@/shared/audit/redact';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx } from '@/shared/database/transaction';

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

async function seedRedactableEvent(orgId: string, actorId: string) {
  const sensitivePayload: Record<string, unknown> = { data: { userId: actorId } };
  for (const key of AUDIT_REDACTION_DENYLIST) {
    sensitivePayload[key] = 'super-secret-value';
    (sensitivePayload.data as Record<string, unknown>)[key] = 'nested-secret';
  }

  await withTx(async (tx) => {
    await emitAudit(tx, {
      orgId,
      actorId,
      event: 'meeting.created',
      entityType: 'meeting',
      entityId: null,
      payload: sensitivePayload,
    });
  });
}

function findDenyListKeys(obj: unknown): string[] {
  const found: string[] = [];
  function walk(val: unknown) {
    if (Array.isArray(val)) {
      val.forEach(walk);
    } else if (val !== null && typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if ((AUDIT_REDACTION_DENYLIST as readonly string[]).includes(k)) found.push(k);
        walk(v);
      }
    }
  }
  walk(obj);
  return found;
}

describe('Audit Payload Redaction (FR-504a, SC-504a)', () => {
  it('stored audit_logs.payload still contains deny-list fields', async () => {
    const { user, orgId } = await setupAuditContext(app);
    await seedRedactableEvent(orgId, user.id);

    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.orgId, orgId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const found = findDenyListKeys(row.payload);
      expect(found.length).toBeGreaterThan(0);
    }
  });

  it('query endpoint does not return any deny-list field', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedRedactableEvent(orgId, user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    for (const entry of data.entries) {
      const found = findDenyListKeys(entry.payload);
      expect(found).toHaveLength(0);
    }
  });

  it('export endpoint does not return any deny-list field in CSV', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedRedactableEvent(orgId, user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}/export?format=csv`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    for (const key of AUDIT_REDACTION_DENYLIST) {
      expect(res.body).not.toContain(`"${key}"`);
    }
  });
});
