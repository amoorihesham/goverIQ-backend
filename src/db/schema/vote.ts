import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { meetings } from './meeting';
import { memberships } from './org';

export const voteStatusEnum = pgEnum('vote_status', ['OPEN', 'CLOSED']);

export const voteOutcomeEnum = pgEnum('vote_outcome', [
  'PASSED',
  'FAILED',
  'TIED',
  'QUORUM_NOT_MET',
]);

export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    options: text('options').array().notNull(),
    status: voteStatusEnum('status').notNull().default('OPEN'),
    outcome: voteOutcomeEnum('outcome'),
    resultSummary: jsonb('result_summary'),
    deadline: timestamp('deadline'),
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    meetingStatusIdx: index('votes_meeting_status_idx').on(table.meetingId, table.status),
  }),
);

export const voteEligibility = pgTable(
  'vote_eligibility',
  {
    voteId: uuid('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: uniqueIndex('vote_eligibility_pkey').on(table.voteId, table.memberId),
  }),
);

export const ballots = pgTable(
  'ballots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    voteId: uuid('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    choice: text('choice').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    voteVoterUnique: uniqueIndex('ballots_vote_voter_unique').on(table.voteId, table.memberId),
  }),
);
