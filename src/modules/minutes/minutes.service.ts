import { and, asc, eq } from 'drizzle-orm';

import { CreateMinutesBody, EditMinutesBody, AttachResolutionBody, AppendCorrectionBody } from './types/request';
import { renderMinutesPdf } from './utils/pdf';

import { meetings } from '@/db/schema/meeting';
import { minutes, minutesResolutions, minutesCorrections } from '@/db/schema/minutes';
import { votes } from '@/db/schema/vote';
import { emitAudit } from '@/shared/audit/emitter';
import { isUniqueViolation } from '@/shared/database/errors';
import { withTx, type Tx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';

export const minutesService = (db: DatabaseClient) => {
  async function findMeetingInOrgOrThrow(meetingId: string, orgId: string, tx?: Tx) {
    const client = tx ?? db;
    const [meeting] = await client
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, meetingId), eq(meetings.orgId, orgId)))
      .limit(1);
    if (!meeting) throw AppError.notFound('Meeting not found');
    return meeting;
  }

  async function findMinutesForMeetingOrThrow(meetingId: string, tx?: Tx) {
    const client = tx ?? db;
    const [doc] = await client.select().from(minutes).where(eq(minutes.meetingId, meetingId)).limit(1);
    if (!doc) throw AppError.notFound('Minutes not found for this meeting');
    return doc;
  }

  return {
    findMeetingInOrgOrThrow,
    findMinutesForMeetingOrThrow,

    async createMinutes(userId: string, orgId: string, meetingId: string, body: CreateMinutesBody) {
      return withTx(async (tx) => {
        const meeting = await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        if (meeting.status !== 'COMPLETED') {
          throw AppError.invalidStateTransition('Minutes can only be created for a COMPLETED meeting');
        }

        let doc;
        try {
          [doc] = await tx
            .insert(minutes)
            .values({
              meetingId,
              summary: body.summary,
              attendanceNotes: body.attendanceNotes,
              status: 'DRAFT',
            })
            .returning();
        } catch (err) {
          if (isUniqueViolation(err)) throw AppError.conflict('Minutes already exist for this meeting');
          throw err;
        }

        if (!doc) throw AppError.internalError('Failed to create minutes');

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'minutes.created',
          entityType: 'minutes',
          entityId: doc.id,
          payload: { data: { meetingId } },
        });

        return doc;
      });
    },

    async editMinutes(userId: string, orgId: string, meetingId: string, body: EditMinutesBody) {
      return withTx(async (tx) => {
        await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        const doc = await findMinutesForMeetingOrThrow(meetingId, tx);

        if (doc.status !== 'DRAFT') throw AppError.minutesFinalized();

        const before = { summary: doc.summary, attendanceNotes: doc.attendanceNotes };

        const [updated] = await tx
          .update(minutes)
          .set({
            summary: body.summary !== undefined ? body.summary : doc.summary,
            attendanceNotes: body.attendanceNotes !== undefined ? body.attendanceNotes : doc.attendanceNotes,
            updatedAt: new Date(),
          })
          .where(eq(minutes.id, doc.id))
          .returning();

        if (!updated) throw AppError.internalError('Failed to update minutes');

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'minutes.updated',
          entityType: 'minutes',
          entityId: doc.id,
          payload: {
            before,
            after: { summary: updated.summary, attendanceNotes: updated.attendanceNotes },
          },
        });

        return updated;
      });
    },

    async attachResolution(userId: string, orgId: string, meetingId: string, body: AttachResolutionBody) {
      return withTx(async (tx) => {
        await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        const doc = await findMinutesForMeetingOrThrow(meetingId, tx);

        if (doc.status !== 'DRAFT') throw AppError.minutesFinalized();

        // Verify the vote belongs to this meeting and is CLOSED
        const [vote] = await tx
          .select({ id: votes.id, status: votes.status, meetingId: votes.meetingId })
          .from(votes)
          .where(eq(votes.id, body.voteId))
          .limit(1);

        if (!vote || vote.meetingId !== meetingId) {
          throw AppError.validationError('Vote does not belong to this meeting');
        }
        if (vote.status !== 'CLOSED') {
          throw AppError.validationError('Vote must be CLOSED to attach as a resolution');
        }

        const [resolution] = await tx
          .insert(minutesResolutions)
          .values({ minutesId: doc.id, voteId: body.voteId, description: body.description })
          .returning();

        if (!resolution) throw AppError.internalError('Failed to attach resolution');

        return resolution;
      });
    },

    async finalizeMinutes(userId: string, orgId: string, meetingId: string) {
      return withTx(async (tx) => {
        await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        const doc = await findMinutesForMeetingOrThrow(meetingId, tx);

        if (doc.status !== 'DRAFT') throw AppError.conflict('Minutes are already finalized');

        const [finalized] = await tx
          .update(minutes)
          .set({ status: 'FINALIZED', finalizedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(minutes.id, doc.id), eq(minutes.status, 'DRAFT')))
          .returning();

        if (!finalized) throw AppError.conflict('Minutes were finalized concurrently; please retry');

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'minutes.finalized',
          entityType: 'minutes',
          entityId: doc.id,
          payload: { before: { status: 'DRAFT' }, after: { status: 'FINALIZED' } },
        });

        return finalized;
      });
    },

    async appendCorrection(userId: string, orgId: string, meetingId: string, body: AppendCorrectionBody) {
      return withTx(async (tx) => {
        await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        const doc = await findMinutesForMeetingOrThrow(meetingId, tx);

        if (doc.status !== 'FINALIZED') {
          throw AppError.invalidStateTransition('Corrections can only be appended to FINALIZED minutes');
        }

        const [correction] = await tx
          .insert(minutesCorrections)
          .values({ minutesId: doc.id, content: body.content })
          .returning();

        if (!correction) throw AppError.internalError('Failed to append correction');

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'minutes.correction_added',
          entityType: 'minutes',
          entityId: doc.id,
          payload: { data: { correctionId: correction.id } },
        });

        return correction;
      });
    },

    async readMinutes(orgId: string, meetingId: string) {
      await findMeetingInOrgOrThrow(meetingId, orgId);
      const doc = await findMinutesForMeetingOrThrow(meetingId);

      const resolutions = await db.select().from(minutesResolutions).where(eq(minutesResolutions.minutesId, doc.id));

      const corrections = await db
        .select()
        .from(minutesCorrections)
        .where(eq(minutesCorrections.minutesId, doc.id))
        .orderBy(asc(minutesCorrections.createdAt));

      return { ...doc, resolutions, corrections };
    },

    async exportMinutes(userId: string, orgId: string, meetingId: string) {
      return withTx(async (tx) => {
        const meeting = await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        const doc = await findMinutesForMeetingOrThrow(meetingId, tx);

        const resolutions = await tx.select().from(minutesResolutions).where(eq(minutesResolutions.minutesId, doc.id));

        const corrections = await tx
          .select()
          .from(minutesCorrections)
          .where(eq(minutesCorrections.minutesId, doc.id))
          .orderBy(asc(minutesCorrections.createdAt));

        const pdfBuffer = await renderMinutesPdf({ meeting, minutes: doc, resolutions, corrections });

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'minutes.exported',
          entityType: 'minutes',
          entityId: doc.id,
          payload: { data: { meetingId, format: 'pdf' } },
        });

        return pdfBuffer;
      });
    },
  };
};
