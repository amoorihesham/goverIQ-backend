import { sql } from 'drizzle-orm';

import { db } from '@/shared/database/client';

// Truncation order matters: child tables before parent, though CASCADE handles it.
// audit_logs has no FK to users so it's listed first for clarity.
export async function truncateAllTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE audit_logs, refresh_tokens, email_verifications, users, organizations, roles, memberships, invitations, meetings, meeting_agenda_items, meeting_attendees, votes, vote_eligibility, ballots, minutes, minutes_resolutions, minutes_corrections RESTART IDENTITY CASCADE`,
  );
}

<<<<<<< HEAD
export async function truncateOrgTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE organizations, roles, memberships, invitations RESTART IDENTITY CASCADE`,
  );
}

export async function truncateMeetingTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE meetings, meeting_agenda_items, meeting_attendees RESTART IDENTITY CASCADE`,
  );
}
<<<<<<< HEAD
=======

export async function truncateVoteTables(): Promise<void> {
  await db.execute(sql`TRUNCATE votes, vote_eligibility, ballots RESTART IDENTITY CASCADE`);
}

export async function truncateMinutesTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE minutes, minutes_resolutions, minutes_corrections RESTART IDENTITY CASCADE`,
  );
}
>>>>>>> 005-voting-minutes
=======


>>>>>>> main
