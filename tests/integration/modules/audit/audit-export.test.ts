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

describe('GET /api/v1/audit/org/:orgId/export — Audit Export (FR-505/FR-506)', () => {
  it('200 exports CSV — valid flat file with header + data rows', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedAuditEvents(orgId, user.id, 3);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}/export?format=csv`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');

    const lines = res.body.split('\r\n').filter(Boolean);
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('event');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('200 exports PDF — valid %PDF document', async () => {
    const { user, token, orgId } = await setupAuditContext(app);
    await seedAuditEvents(orgId, user.id, 2);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}/export?format=pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('.pdf');
    expect(res.body.startsWith('%PDF')).toBe(true);
  });

  it('400 returns VALIDATION_ERROR for unsupported format', async () => {
    const { token, orgId } = await setupAuditContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}/export?format=xlsx`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('200 CSV with no matching entries still has header row only', async () => {
    const { token, orgId } = await setupAuditContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}/export?format=csv&event=nonexistent.event`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const lines = res.body.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('id');
  });

  it('200 PDF with no matching entries is a well-formed PDF', async () => {
    const { token, orgId } = await setupAuditContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}/export?format=pdf&event=nonexistent.event`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.startsWith('%PDF')).toBe(true);
  });

  it('403 returns FORBIDDEN when caller lacks audit:export', async () => {
    const { orgId } = await setupAuditContext(app);
    const otherCtx = await setupAuditContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/org/${orgId}/export`,
      headers: { authorization: `Bearer ${otherCtx.token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
