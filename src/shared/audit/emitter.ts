import { env } from '../config/env';

import { auditEmitTotal } from './meter';
import { AuditEvent } from './types';

import { auditLogs } from '@/db/schema/audit';
import type { Tx } from '@/shared/database/transaction';
import { AppError } from '@/shared/errors/http-error';

export async function emitAudit(tx: Tx, event: AuditEvent): Promise<void> {
  assertValidTx(tx);

  const attrs = { event: event.event, entity_type: event.entityType };

  const payload = buildPayload(event.payload);

  if (!isPayloadWithinSizeLimit(payload)) {
    auditEmitTotal.add(1, { ...attrs, outcome: 'rejected' });
    throw AppError.validationError('Audit event payload exceeds maximum allowed size');
  }

  try {
    await tx.insert(auditLogs).values({
      orgId: event.orgId || null,
      actorId: event.actorId || null,
      event: event.event,
      entityType: event.entityType,
      entityId: event.entityId || null,
      payload,
    });
    auditEmitTotal.add(1, { ...attrs, outcome: 'success' });
  } catch (err) {
    auditEmitTotal.add(1, { ...attrs, outcome: 'error' });
    throw err;
  }
}

function assertValidTx(tx: unknown): asserts tx is Tx {
  if (!tx || typeof tx !== 'object' || !('insert' in tx)) {
    throw AppError.internalError('Invalid transaction handle provided to audit emitter');
  }
}

function buildPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function isPayloadWithinSizeLimit(payload: string): boolean {
  const byteSize = Buffer.byteLength(payload, 'utf-8');
  return byteSize <= env.MAX_BODY_LIMIT;
}
