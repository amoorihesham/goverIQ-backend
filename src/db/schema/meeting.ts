import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { memberships } from './org';

export const meetingStatusEnum = pgEnum('meeting_status', [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: meetingStatusEnum('status').notNull().default('DRAFT'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('meetings_org_status_idx').on(table.orgId, table.status),
    scheduledAtIdx: index('meetings_scheduled_at_idx').on(table.scheduledAt),
  }),
);

export const meetingAgendaItems = pgTable(
  'meeting_agenda_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    orderIndex: integer('order_index').notNull(),
  },
  (table) => ({
    meetingOrderUnique: uniqueIndex('meeting_agenda_items_meeting_order_unique').on(table.meetingId, table.orderIndex),
  }),
);

export const meetingAttendees = pgTable(
  'meeting_attendees',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    primaryKey: uniqueIndex('meeting_attendees_pkey').on(table.meetingId, table.memberId),
  }),
);
