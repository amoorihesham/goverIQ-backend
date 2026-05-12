import { auditLogs } from '@/db/schema/audit';
import type { Tx } from '@/shared/database/transaction';
import { AppError } from '@/shared/errors/http-error';
import { logger } from '@/shared/logger';
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('groven_iq');

const auditEmitTotal = meter.createCounter('audit_emitted', { description: 'Audit events emitted' });

const MAX_PAYLOAD_SIZE = 64 * 1024; // 64 KiB

export interface AuditEvent {
  orgId?: string | null;
  actorId?: string | null;
  event: string;
  entityType: string;
  entityId?: string | null;

  payload: Record<string, unknown>;
}

export async function emitAudit(tx: Tx, event: AuditEvent): Promise<void> {
  if (!tx || typeof tx !== 'object' || !('insert' in tx)) {
    throw AppError.internalError('Invalid transaction handle provided to audit emitter');
  }
  const attrs = { event: event.event, entity_type: event.entityType };
  const payloadString = JSON.stringify(event.payload);
  if (payloadString.length > MAX_PAYLOAD_SIZE) {
    logger.warn({ payloadSize: payloadString.length, maxSize: MAX_PAYLOAD_SIZE }, 'Audit payload exceeds maximum size');
    auditEmitTotal.add(1, { ...attrs, outcome: 'rejected' });
    throw AppError.internalError('Audit payload too large');
  }

  try {
    await tx.insert(auditLogs).values({
      orgId: event.orgId || null,
      actorId: event.actorId || null,
      event: event.event,
      entityType: event.entityType,
      entityId: event.entityId || null,
      payload: event.payload,
    });
  } catch (err) {
    auditEmitTotal.add(1, { ...attrs, outcome: 'error' });
    throw err;
  }

  auditEmitTotal.add(1, { ...attrs, outcome: 'success' });
}
