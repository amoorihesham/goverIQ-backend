import { db } from '@/shared/database/client';
import { runMigrations } from '@/shared/database/migrate';

export default async function () {
  await runMigrations(db);
}
