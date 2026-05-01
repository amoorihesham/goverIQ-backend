import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id'),
    actorId: uuid('actor_id'),
    event: text('event').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index('audit_logs_org_created_idx').on(table.orgId, table.createdAt.desc()),
    orgActorIdx: index('audit_logs_org_actor_idx').on(table.orgId, table.actorId),
    orgEventIdx: index('audit_logs_org_event_idx').on(table.orgId, table.event),
    orgEntityIdx: index('audit_logs_org_entity_idx').on(
      table.orgId,
      table.entityType,
      table.entityId,
    ),
  }),
);
