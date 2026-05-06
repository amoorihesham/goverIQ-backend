import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildAuthTestServer } from '../../helpers/server';

import { auditLogs } from '@/db/schema/audit';
import { users } from '@/db/schema/auth';
import { getDatabaseClient } from '@/shared/database/client';

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
  const original = await vi.importActual<typeof import('@/shared/audit/emitter')>(
    '@/shared/audit/emitter',
  );
  vi.mocked(emitAudit).mockImplementation(original.emitAudit);
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildAuthTestServer();
});

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

    const db = getDatabaseClient();
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
    const db = getDatabaseClient();
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
    const db = getDatabaseClient();
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

  it('audit rollback invariant — when emitAudit throws, no user row is committed', async () => {
    const email = uniqueEmail();
    const { emitAudit } = await import('@/shared/audit/emitter');
    vi.mocked(emitAudit).mockRejectedValueOnce(new Error('forced DB failure'));

    const { createAuthService } = await import('@/modules/auth/auth.service');
    const { loadEnv } = await import('@/shared/config/env');
    const env = loadEnv();
    const svc = createAuthService(getDatabaseClient(), {
      ENV: env.NODE_ENV,
      JWT_SECRET: env.JWT_SECRET,
      OTP_TTL_MS: env.OTP_TTL,
      OTP_RESEND_COOLDOWN_SEC: env.OTP_RESEND_COOLDOWN_SEC,
      ACCESS_TTL_SECONDS: env.ACCESS_TTL_SECONDS,
      REFRESH_TTL_SECONDS: env.REFRESH_TTL_SECONDS,
      REFRESH_COOKIE_NAME: env.REFRESH_COOKIE_NAME,
    });

    await expect(
      svc.register({ email, password: 'correct-horse-battery' }),
    ).rejects.toThrow();

    const db = getDatabaseClient();
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
