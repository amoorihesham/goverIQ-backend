import { sql } from 'drizzle-orm';

import { getDatabaseClient } from '@/shared/database/client';

// Truncation order matters: child tables before parent, though CASCADE handles it.
// audit_logs has no FK to users so it's listed first for clarity.
export async function truncateAuthTables(): Promise<void> {
  const db = getDatabaseClient();
  await db.execute(
    sql`TRUNCATE TABLE audit_logs, refresh_tokens, email_verifications, users RESTART IDENTITY CASCADE`,
  );
}
