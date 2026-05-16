import { sql } from 'drizzle-orm';

import { db } from '@/shared/database/client';

// Truncation order matters: child tables before parent, though CASCADE handles it.
// audit_logs has no FK to users so it's listed first for clarity.
export async function truncateAuthTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE audit_logs, refresh_tokens, email_verifications, users RESTART IDENTITY CASCADE`,
  );
}

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
