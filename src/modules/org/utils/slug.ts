import { randomBytes } from 'crypto';

import { eq, sql } from 'drizzle-orm';

import { CONFIGURATIONS } from '../constants';

import { organizations } from '@/db/schema/org';
import { Tx } from '@/shared/database/types';

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function checkSlugExist(tx: Tx, slug: string) {
  return tx.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
}

export async function ensureUniqueSlug(tx: Tx, base: string): Promise<string> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${CONFIGURATIONS.SLUG_LOCK_NAMESPACE}::int, hashtext(${base})::int)`,
  );

  const exists = await checkSlugExist(tx, base);
  if (!exists) return base;

  for (let i = 2; i <= CONFIGURATIONS.SLUG_MAX_SUFFIX_ATTEMPTS + 1; i++) {
    const candidate = `${base}-${i}`;
    const existsCandidate = await checkSlugExist(tx, candidate);

    if (!existsCandidate) return candidate;
  }

  const randomSuffix = randomBytes(CONFIGURATIONS.SLUG_FALLBACK_RANDOM_BYTES).toString('hex');
  return `${base}-${randomSuffix}`;
}
