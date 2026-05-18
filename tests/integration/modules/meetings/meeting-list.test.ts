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

async function createMeeting(
  app: Awaited<ReturnType<typeof buildAppTestServer>>,
  token: string,
  orgId: string,
  title = 'Test Meeting',
  scheduledAt = futureDate(),
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/meetings/org/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { title, scheduledAt },
  });
  if (res.statusCode !== 201) throw new Error(`createMeeting failed: ${res.body}`);
  return res.json().data as { id: string; status: string };
}

describe('GET /api/v1/meetings/org/:orgId — List Meetings (FR-311)', () => {
  it('200 returns empty list when no meetings exist', async () => {
    const { token, orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.items).toHaveLength(0);
    expect(data.nextCursor).toBeNull();
  });

  it('200 lists created meetings', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    await createMeeting(app, token, orgId, 'Meeting A');
    await createMeeting(app, token, orgId, 'Meeting B');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toHaveLength(2);
  });

  it('200 filters by status (FR-311)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const m1 = await createMeeting(app, token, orgId, 'Draft Meeting');
    await createMeeting(app, token, orgId, 'Another Draft');
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/meetings/${m1.id}/org/${orgId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'SCHEDULED' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/org/${orgId}?status=SCHEDULED`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('SCHEDULED');
  });

  it('200 cursor pagination returns nextCursor and next page (FR-311)', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    for (let i = 0; i < 3; i++) {
      await createMeeting(app, token, orgId, `Meeting ${i}`);
      // Small delay ensures each meeting gets a distinct createdAt millisecond so
      // the keyset cursor (which uses JS Date ms precision) works correctly.
      await new Promise((r) => setTimeout(r, 2));
    }

    const page1 = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/org/${orgId}?limit=2`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(page1.statusCode).toBe(200);
    const p1 = page1.json().data;
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/org/${orgId}?limit=2&cursor=${p1.nextCursor}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(page2.statusCode).toBe(200);
    const p2 = page2.json().data;
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it('401 without auth token', async () => {
    const { orgId } = await setupMeetingContext(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/org/${orgId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/meetings/:meetingId/org/:orgId — Get Meeting Detail (FR-312)', () => {
  it('200 returns meeting with agendaItems and attendees', async () => {
    const { token, orgId } = await setupMeetingContext(app);

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/meetings/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Detail Test',
        scheduledAt: futureDate(),
        agendaItems: [{ title: 'Item 1', orderIndex: 0 }],
      },
    });
    const meeting = createRes.json().data;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.id).toBe(meeting.id);
    expect(data.agendaItems).toBeDefined();
    expect(data.attendees).toBeDefined();
    expect(data.agendaItems[0].title).toBe('Item 1');
  });

  it('404 for a meeting in a different org', async () => {
    const { token, orgId } = await setupMeetingContext(app);
    const ctx2 = await setupMeetingContext(app);
    const meeting = await createMeeting(app, ctx2.token, ctx2.orgId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meetings/${meeting.id}/org/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
