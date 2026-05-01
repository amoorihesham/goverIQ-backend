import pino from 'pino';

import { auditLogs } from '@/db/schema/audit';
import type { Tx } from '@/shared/database/transaction';
import { AppError } from '@/shared/errors/http-error';

const logger = pino();

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

  const payloadString = JSON.stringify(event.payload);
  if (payloadString.length > MAX_PAYLOAD_SIZE) {
    logger.warn(
      { payloadSize: payloadString.length, maxSize: MAX_PAYLOAD_SIZE },
      'Audit payload exceeds maximum size',
    );
    throw AppError.internalError('Audit payload too large');
  }

  await (tx as any)
    .insert(auditLogs)
    .values({
      orgId: event.orgId || null,
      actorId: event.actorId || null,
      event: event.event,
      entityType: event.entityType,
      entityId: event.entityId || null,
      payload: event.payload,
    });
}
