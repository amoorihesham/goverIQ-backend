import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

import { meetings } from './meeting';
import { votes } from './vote';

export const minutesStatusEnum = pgEnum('minutes_status', ['DRAFT', 'FINALIZED']);

export const minutes = pgTable(
  'minutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    summary: text('summary'),
    attendanceNotes: text('attendance_notes'),
    status: minutesStatusEnum('status').notNull().default('DRAFT'),
    finalizedAt: timestamp('finalized_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    meetingIdUnique: uniqueIndex('minutes_meeting_id_unique').on(table.meetingId),
  }),
);

export const minutesResolutions = pgTable(
  'minutes_resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minutesId: uuid('minutes_id')
      .notNull()
      .references(() => minutes.id, { onDelete: 'cascade' }),
    voteId: uuid('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    minutesIdIdx: index('minutes_resolutions_minutes_idx').on(table.minutesId),
  }),
);

export const minutesCorrections = pgTable(
  'minutes_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minutesId: uuid('minutes_id')
      .notNull()
      .references(() => minutes.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    minutesIdCreatedIdx: index('minutes_corrections_minutes_created_idx').on(table.minutesId, table.createdAt.desc()),
  }),
);
