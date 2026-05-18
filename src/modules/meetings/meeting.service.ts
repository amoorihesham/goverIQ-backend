import { and, count, eq, gte, inArray, lte } from 'drizzle-orm';

import { MEETING_EARLY_OPEN_MINUTES, MEETINGS_PAGE_SIZE_DEFAULT, MEETINGS_PAGE_SIZE_MAX } from './constants';
import {
  CreateMeetingBody,
  TransitionStatusBody,
  AddAttendeesBody,
  ListMeetingsQuery,
  UpdateMeetingBody,
} from './types/request';
import { assertValidTransition } from './utils/state-machine';

import { meetings, meetingAgendaItems, meetingAttendees } from '@/db/schema/meeting';
import { memberships } from '@/db/schema/org';
import { votes } from '@/db/schema/vote';
import { emitAudit } from '@/shared/audit/emitter';
import { withTx, type Tx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
import { applyKeysetWhere, decodeCursor, encodeCursor } from '@/shared/pagination/cursor';
import { CursorPage } from '@/shared/pagination/types';

export const meetingService = (db: DatabaseClient) => {
  async function findMeetingInOrgOrThrow(meetingId: string, orgId: string, tx?: Tx) {
    const client = tx ?? db;
    const meeting = await client.query.meetings.findFirst({
      where: and(eq(meetings.id, meetingId), eq(meetings.orgId, orgId)),
    });
    if (!meeting) throw AppError.notFound('Meeting not found');
    return meeting;
  }

  return {
    async createMeeting(userId: string, orgId: string, body: CreateMeetingBody) {
      return withTx(async (tx) => {
        const [meeting] = await tx
          .insert(meetings)
          .values({
            orgId,
            title: body.title,
            description: body.description,
            location: body.location,
            scheduledAt: new Date(body.scheduledAt),
            status: 'DRAFT',
          })
          .returning();

        if (!meeting) throw AppError.internalError('Failed to create meeting');

        if (body.agendaItems && body.agendaItems.length > 0) {
          await tx.insert(meetingAgendaItems).values(
            body.agendaItems.map((item) => ({
              meetingId: meeting.id,
              title: item.title,
              description: item.description,
              orderIndex: item.orderIndex,
            })),
          );
        }

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'meeting.created',
          entityType: 'meeting',
          entityId: meeting.id,
          payload: { data: { title: meeting.title, scheduledAt: meeting.scheduledAt } },
        });

        return meeting;
      });
    },

    async transitionStatus(userId: string, orgId: string, meetingId: string, body: TransitionStatusBody) {
      return withTx(async (tx) => {
        const meeting = await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        assertValidTransition(meeting.status, body.status);

        if (meeting.status === 'SCHEDULED' && body.status === 'IN_PROGRESS') {
          const earliest = new Date(meeting.scheduledAt.getTime() - MEETING_EARLY_OPEN_MINUTES * 60_000);
          if (Date.now() < earliest.getTime()) throw AppError.meetingTooEarly();

          const [attendeeRow] = await tx
            .select({ n: count() })
            .from(meetingAttendees)
            .where(eq(meetingAttendees.meetingId, meetingId));
          if ((attendeeRow?.n ?? 0) < 1) {
            throw AppError.invalidStateTransition('Meeting has no attendees');
          }
        }

        if (meeting.status === 'IN_PROGRESS' && body.status === 'COMPLETED') {
          const [openVotes] = await tx
            .select({ n: count() })
            .from(votes)
            .where(and(eq(votes.meetingId, meetingId), eq(votes.status, 'OPEN')));
          if ((openVotes?.n ?? 0) > 0) throw AppError.meetingHasOpenVotes();
        }

        const [updated] = await tx
          .update(meetings)
          .set({ status: body.status, updatedAt: new Date() })
          .where(and(eq(meetings.id, meetingId), eq(meetings.status, meeting.status)))
          .returning();

        if (!updated) {
          throw AppError.invalidStateTransition('Meeting status changed concurrently; please retry');
        }

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'meeting.status_changed',
          entityType: 'meeting',
          entityId: meetingId,
          payload: { before: meeting.status, after: body.status },
        });

        return updated;
      });
    },

    async addAttendees(userId: string, orgId: string, meetingId: string, body: AddAttendeesBody) {
      return withTx(async (tx) => {
        const meeting = await findMeetingInOrgOrThrow(meetingId, orgId, tx);

        if (!['DRAFT', 'SCHEDULED', 'IN_PROGRESS'].includes(meeting.status)) {
          throw AppError.invalidStateTransition('Cannot add attendees to a meeting in this state');
        }

        const found = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(inArray(memberships.id, body.memberIds), eq(memberships.orgId, orgId)));
        const foundIds = new Set(found.map((m) => m.id));
        const missing = body.memberIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          throw AppError.notFound(`Member(s) not in this organization: ${missing.join(', ')}`);
        }

        const inserted = await tx
          .insert(meetingAttendees)
          .values(body.memberIds.map((memberId) => ({ meetingId, memberId })))
          .onConflictDoNothing()
          .returning();

        for (const row of inserted) {
          await emitAudit(tx, {
            orgId,
            actorId: userId,
            event: 'meeting.attendee_added',
            entityType: 'meeting',
            entityId: meetingId,
            payload: { data: { memberId: row.memberId } },
          });
        }

        return inserted;
      });
    },

    async removeAttendee(userId: string, orgId: string, meetingId: string, memberId: string) {
      return withTx(async (tx) => {
        const meeting = await findMeetingInOrgOrThrow(meetingId, orgId, tx);

        if (!['DRAFT', 'SCHEDULED', 'IN_PROGRESS'].includes(meeting.status)) {
          throw AppError.invalidStateTransition('Cannot remove attendees from a meeting in this state');
        }

        const [deleted] = await tx
          .delete(meetingAttendees)
          .where(and(eq(meetingAttendees.meetingId, meetingId), eq(meetingAttendees.memberId, memberId)))
          .returning();

        if (!deleted) throw AppError.notFound('Attendee not found');

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'meeting.attendee_removed',
          entityType: 'meeting',
          entityId: meetingId,
          payload: { data: { memberId } },
        });
      });
    },

    async listMeetings(orgId: string, query: ListMeetingsQuery): Promise<CursorPage<typeof meetings.$inferSelect>> {
      const limit = Math.min(query.limit ?? MEETINGS_PAGE_SIZE_DEFAULT, MEETINGS_PAGE_SIZE_MAX);
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

      const conditions = [eq(meetings.orgId, orgId)];
      if (query.status) conditions.push(eq(meetings.status, query.status));
      if (query.from) conditions.push(gte(meetings.scheduledAt, new Date(query.from)));
      if (query.to) conditions.push(lte(meetings.scheduledAt, new Date(query.to)));
      if (query.attendeeId) {
        conditions.push(
          inArray(
            meetings.id,
            db
              .select({ meetingId: meetingAttendees.meetingId })
              .from(meetingAttendees)
              .where(eq(meetingAttendees.memberId, query.attendeeId)),
          ),
        );
      }

      const keysetWhere = applyKeysetWhere(meetings.createdAt, meetings.id, cursor, 'asc');
      if (keysetWhere) conditions.push(keysetWhere);

      const rows = await db.query.meetings.findMany({
        where: and(...conditions),
        limit: limit + 1,
        orderBy: (m, { asc }) => [asc(m.createdAt), asc(m.id)],
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

      return { items, nextCursor };
    },

    async getMeeting(meetingId: string, orgId: string) {
      const meeting = await findMeetingInOrgOrThrow(meetingId, orgId);

      const agendaItems = await db.query.meetingAgendaItems.findMany({
        where: eq(meetingAgendaItems.meetingId, meetingId),
        orderBy: (a, { asc }) => [asc(a.orderIndex)],
      });

      const attendees = await db.query.meetingAttendees.findMany({
        where: eq(meetingAttendees.meetingId, meetingId),
      });

      return { ...meeting, agendaItems, attendees };
    },

    async updateMeeting(userId: string, orgId: string, meetingId: string, body: UpdateMeetingBody) {
      return withTx(async (tx) => {
        const meeting = await findMeetingInOrgOrThrow(meetingId, orgId, tx);

        if (!['DRAFT', 'SCHEDULED'].includes(meeting.status)) {
          throw AppError.invalidStateTransition('Cannot edit a meeting that is not in DRAFT or SCHEDULED state');
        }

        const [updated] = await tx
          .update(meetings)
          .set({
            title: body.title ?? meeting.title,
            description: body.description !== undefined ? body.description : meeting.description,
            location: body.location !== undefined ? body.location : meeting.location,
            scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : meeting.scheduledAt,
            updatedAt: new Date(),
          })
          .where(eq(meetings.id, meetingId))
          .returning();

        if (body.agendaItems !== undefined) {
          await tx.delete(meetingAgendaItems).where(eq(meetingAgendaItems.meetingId, meetingId));
          if (body.agendaItems.length > 0) {
            await tx.insert(meetingAgendaItems).values(
              body.agendaItems.map((item) => ({
                meetingId,
                title: item.title,
                description: item.description,
                orderIndex: item.orderIndex,
              })),
            );
          }
        }

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'meeting.updated',
          entityType: 'meeting',
          entityId: meetingId,
          payload: {
            before: { title: meeting.title, scheduledAt: meeting.scheduledAt },
            after: { title: updated!.title, scheduledAt: updated!.scheduledAt },
          },
        });

        return updated!;
      });
    },
  };
};
