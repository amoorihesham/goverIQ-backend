import { eq } from 'drizzle-orm';
import { organizations } from '@/db/schema/org';
import { SLUG_MAX_SUFFIX_ATTEMPTS, SLUG_FALLBACK_RANDOM_BYTES } from './constants';
import { randomBytes } from 'crypto';

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric chars with hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

export async function ensureUniqueSlug(db: any, base: string): Promise<string> {
  // Try base slug first
  const checkExists = (slug: string) => {
    return db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
  };

  const exists = await checkExists(base);
  if (exists.length === 0) {
    return base;
  }

  // Try numeric suffixes starting from 2, up to SLUG_MAX_SUFFIX_ATTEMPTS + 1
  for (let i = 2; i <= SLUG_MAX_SUFFIX_ATTEMPTS + 1; i++) {
    const candidate = `${base}-${i}`;
    const existsCandidate = await checkExists(candidate);

    if (existsCandidate.length === 0) {
      return candidate;
    }
  }

  // Fallback to random suffix
  const randomSuffix = randomBytes(SLUG_FALLBACK_RANDOM_BYTES).toString('hex');
  return `${base}-${randomSuffix}`;
}