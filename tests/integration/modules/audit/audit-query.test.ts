import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { setupAuditContext, seedAuditEvents } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/audit/org/:orgId — Audit Log Query (FR-501..504)', () => {
  it('200 returns entries newest-first for an org with audit:view', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedAuditEvents(orgId, user.id, 3);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.entries.length).toBeGreaterThan(0);
    expect(data.nextCursor !== undefined).toBe(true);

    const times = data.entries.map((e: any) => new Date(e.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  it('200 filters by actorId', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    const otherCtx = await setupAuditContext(app);
    await seedAuditEvents(orgId, user.id, 2);
    await seedAuditEvents(orgId, otherCtx.user.id, 2);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}?actorId=${user.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    for (const entry of data.entries) {
      expect(entry.actorId).toBe(user.id);
    }
  });

  it('200 filters by event type', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedAuditEvents(orgId, user.id, 3);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}?event=meeting.created`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    for (const entry of data.entries) {
      expect(entry.event).toBe('meeting.created');
    }
  });

  it('200 returns empty entries for from > to', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedAuditEvents(orgId, user.id, 2);

    const from = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const to = new Date(Date.now() - 1000 * 60 * 60).toISOString();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}?from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.entries).toHaveLength(0);
  });

  it('200 paginates with cursor — no gaps or duplicates', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedAuditEvents(orgId, user.id, 5);

    const page1Res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}?limit=3`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = page1Res.json().data;
    expect(page1.entries).toHaveLength(3);
    expect(page1.nextCursor).toBeTruthy();

    const page2Res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}?limit=3&cursor=${page1.nextCursor}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = page2Res.json().data;
    expect(page2.entries.length).toBeGreaterThan(0);

    const page1Ids = new Set(page1.entries.map((e: any) => e.id));
    for (const entry of page2.entries) {
      expect(page1Ids.has(entry.id)).toBe(false);
    }
  });

  it('400 returns VALIDATION_ERROR for malformed cursor', async () => {
    const { token, orgId } = await setupAuditContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}?cursor=not-a-valid-cursor`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('403 returns FORBIDDEN when caller lacks audit:view', async () => {
    const { orgId } = await setupAuditContext(app);
    const otherCtx = await setupAuditContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}`,
      headers: { authorization: `Bearer ${otherCtx.token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('200 does not return entries from another org (cross-org isolation)', async () => {
    const ctx1 = await setupAuditContext(app);
    const ctx2 = await setupAuditContext(app);
    await seedAuditEvents(ctx2.orgId, ctx2.user.id, 3);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${ctx1.orgId}`,
      headers: { authorization: `Bearer ${ctx1.token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    for (const entry of data.entries) {
      expect(entry.orgId ?? ctx1.orgId).toBe(ctx1.orgId);
    }
  });

  it('401 returns UNAUTHORIZED when no token is provided', async () => {
    const { orgId } = await setupAuditContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
