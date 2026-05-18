import type { AuditEventName } from './events';

export interface AuditEvent {
  orgId?: string | null;
  actorId?: string | null;
  event: AuditEventName;
  entityType: string;
  entityId?: string | null;
  payload: Record<string, unknown>;
}
