import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../../helpers/db';
import { buildAppTestServer } from '../../helpers/server';
import { futureDate, setupMeetingContext } from './helpers';

let app: Awaited<ReturnType<typeof buildAppTestServer>>;

beforeAll(async () => {
  app = await buildAppTestServer();
});

beforeEach(truncateAllTables);

afterAll(async () => {
  await app.close();
});

describe('POST /api/v1/meetings/org/:orgId — Create Meeting (FR-301/302/303/317)', () => {
  it('201 creates a meeting with DRAFT status (FR-301)', async () => {
    const { token, orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Q1 Review', scheduledAt: futureDate() },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.title).toBe('Q1 Review');
    expect(body.data.status).toBe('DRAFT');
    expect(body.data.orgId).toBe(orgId);
  });

  it('201 creates a meeting with agenda items (FR-303)', async () => {
    const { token, orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Board Meeting',
        scheduledAt: futureDate(),
        agendaItems: [
          { title: 'Opening', orderIndex: 0 },
          { title: 'Financial Report', description: 'Q1 numbers', orderIndex: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.title).toBe('Board Meeting');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${res.json().data.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const { data } = detail.json();
    expect(data.agendaItems).toHaveLength(2);
    expect(data.agendaItems[0].title).toBe('Opening');
    expect(data.agendaItems[1].title).toBe('Financial Report');
  });

  it('201 creates a meeting with no agenda items (FR-301 spec clarification)', async () => {
    const { token, orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Quick Sync', scheduledAt: futureDate() },
    });

    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.status).toBe('DRAFT');
  });

  it('400 when scheduledAt is in the past (FR-317)', async () => {
    const { token, orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Past Meeting',
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('400 when agenda items have duplicate orderIndex (FR-303)', async () => {
    const { token, orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Dup Agenda',
        scheduledAt: futureDate(),
        agendaItems: [
          { title: 'Item A', orderIndex: 0 },
          { title: 'Item B', orderIndex: 0 },
        ],
      },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('401 without auth token', async () => {
    const { orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      payload: { title: 'Test', scheduledAt: futureDate() },
    });

    expect(res.statusCode).toBe(401);
  });
});
