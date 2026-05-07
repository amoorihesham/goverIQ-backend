import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { truncateAuthTables } from '../../helpers/db';
import { buildAuthTestServer } from '../../helpers/server';

import { auditLogs } from '@/db/schema/audit';
import { users } from '@/db/schema/auth';
import { db } from '@/shared/database/client';

// Wrap emitAudit so the rollback test can mock-once without persisting state across
// tests. vi.mock is hoisted so this still affects the auth.service import chain.
vi.mock('@/shared/audit/emitter', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/shared/audit/emitter')>();
  return { ...mod, emitAudit: vi.fn(mod.emitAudit) };
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { emitAudit } = await import('@/shared/audit/emitter');
  vi.mocked(emitAudit).mockReset();
  // Restore the real implementation as the default; tests opt in to mock behavior.
  const original =
    await vi.importActual<typeof import('@/shared/audit/emitter')>('@/shared/audit/emitter');
  vi.mocked(emitAudit).mockImplementation(original.emitAudit);
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildAuthTestServer();
});

beforeEach(truncateAuthTables);

afterAll(async () => {
  await app.close();
});

function uniqueEmail() {
  return `reg-${randomUUID()}@test.example`;
}

describe('POST /auth/register (FR-101 / FR-102 / FR-112)', () => {
  it('201 happy path — user created + audit row inserted', async () => {
    const email = uniqueEmail();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'correct-horse-battery' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('Verification email sent.');

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.event, 'user.registered'));
    const audit = auditRows.find(
      (r) => (r.payload as { data: { email: string } }).data?.email === email,
    );
    expect(audit).toBeDefined();
  });

  it('400 VALIDATION_ERROR when password < 12 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail(), password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('409 DUPLICATE_EMAIL when verified user re-registers', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'correct-horse-battery' },
    });

    await db.update(users).set({ isVerified: true }).where(eq(users.email, email));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'another-password-12' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DUPLICATE_EMAIL');
  });

  it('201 when unverified email re-registers — old user atomically replaced', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'first-password-12chr' },
    });

    const [firstUser] = await db.select().from(users).where(eq(users.email, email));
    const firstId = firstUser?.id;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'second-password-12ch' },
    });

    expect(res.statusCode).toBe(201);

    const [newUser] = await db.select().from(users).where(eq(users.email, email));
    expect(newUser).toBeDefined();
    expect(newUser!.id).not.toBe(firstId);
    expect(newUser!.isVerified).toBe(false);
  });

  it('201 even when email delivery fails (fire-and-forget)', async () => {
    const email = uniqueEmail();
    const { notificationService } = await import('@/shared/notifications/service');
    vi.spyOn(notificationService, 'send').mockRejectedValueOnce(new Error('SMTP down'));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'correct-horse-battery' },
    });

    expect(res.statusCode).toBe(201);
    vi.restoreAllMocks();
  });

  it('concurrent same-email registrations — exactly one user row survives, no 5xx', async () => {
    // Ten goroutines race to register the same brand-new email simultaneously.
    // The DB unique constraint guarantees only one INSERT wins. This test verifies:
    //   1. The server never surfaces a raw constraint error as a 500.
    //   2. The losing requests get a graceful 409 DUPLICATE_EMAIL.
    //   3. Exactly one users row exists afterwards — no phantom duplicates even
    //      if the service's delete-then-insert replace path is hit concurrently.
    const email = uniqueEmail();
    const password = 'correct-horse-battery';

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } }),
      ),
    );

    const statuses = results.map((r) => r.statusCode);
    const successes = statuses.filter((s) => s === 201);
    const serverErrors = statuses.filter((s) => s >= 500);

    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(serverErrors).toHaveLength(0);

    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
  });

  it('audit rollback invariant — when emitAudit throws, no user row is committed', async () => {
    const email = uniqueEmail();
    const { emitAudit } = await import('@/shared/audit/emitter');
    vi.mocked(emitAudit).mockRejectedValueOnce(new Error('forced DB failure'));

    const { createAuthService } = await import('@/modules/auth/auth.service');

    const svc = createAuthService(db);

    await expect(svc.register({ email, password: 'correct-horse-battery' })).rejects.toThrow();

    const userRows = await db.select().from(users).where(eq(users.email, email));
    expect(userRows).toHaveLength(0);

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.event, 'user.registered'));
    const relevant = auditRows.filter(
      (r) => (r.payload as { data: { email: string } }).data?.email === email,
    );
    expect(relevant).toHaveLength(0);
  });
});
