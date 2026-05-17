import { sql } from 'drizzle-orm';

import { db } from '@/shared/database/client';

// Truncation order matters: child tables before parent, though CASCADE handles it.
// audit_logs has no FK to users so it's listed first for clarity.
export async function truncateAllTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE audit_logs, refresh_tokens, email_verifications, users, organizations, roles, memberships, invitations, meetings, meeting_agenda_items, meeting_attendees, votes, vote_eligibility, ballots, minutes, minutes_resolutions, minutes_corrections,  RESTART IDENTITY CASCADE`,
  );
}



