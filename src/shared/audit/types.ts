export interface AuditEvent {
  orgId?: string | null;
  actorId?: string | null;
  event: string;
  entityType: string;
  entityId?: string | null;
  payload: Record<string, unknown>;
}
