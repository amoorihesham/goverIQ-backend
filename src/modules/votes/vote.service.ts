import { and, count, eq } from 'drizzle-orm';

import { VOTES_PAGE_SIZE_DEFAULT, VOTES_PAGE_SIZE_MAX } from './constants';
import { CreateVoteBody, CastBallotBody, ListVotesQuery } from './types/request';
import { computeOutcome } from './utils/outcome';

import { meetingAttendees, meetings } from '@/db/schema/meeting';
import { memberships, organizations } from '@/db/schema/org';
import { votes, voteEligibility, ballots } from '@/db/schema/vote';
import { emitAudit } from '@/shared/audit/emitter';
import { isUniqueViolation } from '@/shared/database/errors';
import { withTx, type Tx } from '@/shared/database/transaction';
import { DatabaseClient } from '@/shared/database/types';
import { AppError } from '@/shared/errors/http-error';
import { applyKeysetWhere, decodeCursor, encodeCursor } from '@/shared/pagination/cursor';
import { CursorPage } from '@/shared/pagination/types';

export const voteService = (db: DatabaseClient) => {
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

  async function findVoteInMeetingOrThrow(voteId: string, meetingId: string, orgId: string, tx?: Tx) {
    const client = tx ?? db;
    const [meetingRow] = await client
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, meetingId), eq(meetings.orgId, orgId)))
      .limit(1);
    if (!meetingRow) throw AppError.notFound('Meeting not found');

    const [vote] = await client
      .select()
      .from(votes)
      .where(and(eq(votes.id, voteId), eq(votes.meetingId, meetingId)))
      .limit(1);
    if (!vote) throw AppError.notFound('Vote not found');
    return vote;
  }

  async function resolveCallerMembershipId(userId: string, orgId: string, tx?: Tx) {
    const client = tx ?? db;
    const [membership] = await client
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
      .limit(1);
    if (!membership) throw AppError.forbidden('Not a member of this organization');
    return membership.id;
  }

  return {
    findMeetingInOrgOrThrow,
    findVoteInMeetingOrThrow,
    resolveCallerMembershipId,

    async createVote(userId: string, orgId: string, meetingId: string, body: CreateVoteBody) {
      return withTx(async (tx) => {
        const meeting = await findMeetingInOrgOrThrow(meetingId, orgId, tx);
        if (meeting.status !== 'IN_PROGRESS') {
          throw AppError.invalidStateTransition('Vote can only be created for an IN_PROGRESS meeting');
        }

        // Resolve eligible set
        let eligibleMemberIds: string[];
        if (body.eligibleMemberIds == null) {
          const attendees = await tx
            .select({ memberId: meetingAttendees.memberId })
            .from(meetingAttendees)
            .where(eq(meetingAttendees.meetingId, meetingId));
          eligibleMemberIds = attendees.map((a) => a.memberId);
        } else {
          const requested = body.eligibleMemberIds;
          const attendees = await tx
            .select({ memberId: meetingAttendees.memberId })
            .from(meetingAttendees)
            .where(eq(meetingAttendees.meetingId, meetingId));
          const attendeeSet = new Set(attendees.map((a) => a.memberId));
          const nonAttendees = requested.filter((id) => !attendeeSet.has(id));
          if (nonAttendees.length > 0) {
            throw AppError.validationError(
              `The following member(s) are not attendees of this meeting: ${nonAttendees.join(', ')}`,
            );
          }
          eligibleMemberIds = requested;
        }

        if (eligibleMemberIds.length === 0) {
          throw AppError.validationError('Eligible voter set must not be empty');
        }

        const [vote] = await tx
          .insert(votes)
          .values({
            meetingId,
            question: body.question,
            options: body.options,
            affirmativeOption: body.affirmativeOption,
            deadline: body.deadline ? new Date(body.deadline) : undefined,
            status: 'OPEN',
          })
          .returning();

        if (!vote) throw AppError.internalError('Failed to create vote');

        await tx.insert(voteEligibility).values(eligibleMemberIds.map((memberId) => ({ voteId: vote.id, memberId })));

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'vote.created',
          entityType: 'vote',
          entityId: vote.id,
          payload: {
            data: {
              question: vote.question,
              optionCount: vote.options.length,
              totalEligible: eligibleMemberIds.length,
            },
          },
        });

        return { ...vote, eligibleCount: eligibleMemberIds.length };
      });
    },

    async castBallot(userId: string, orgId: string, meetingId: string, voteId: string, body: CastBallotBody) {
      return withTx(async (tx) => {
        const vote = await findVoteInMeetingOrThrow(voteId, meetingId, orgId, tx);
        if (vote.status !== 'OPEN') throw AppError.voteClosed();

        const memberId = await resolveCallerMembershipId(userId, orgId, tx);

        const [eligibility] = await tx
          .select()
          .from(voteEligibility)
          .where(and(eq(voteEligibility.voteId, voteId), eq(voteEligibility.memberId, memberId)))
          .limit(1);
        if (!eligibility) throw AppError.forbidden('You are not eligible to vote in this vote');

        if (!vote.options.includes(body.choice)) {
          throw AppError.validationError(`Choice must be one of: ${vote.options.join(', ')}`);
        }

        try {
          await tx.insert(ballots).values({ voteId, memberId, choice: body.choice });
        } catch (err) {
          if (isUniqueViolation(err)) throw AppError.duplicateBallot();
          throw err;
        }

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'ballot.submitted',
          entityType: 'vote',
          entityId: voteId,
          payload: { data: { voteId } },
        });
      });
    },

    async closeVote(userId: string, orgId: string, meetingId: string, voteId: string) {
      return withTx(async (tx) => {
        const vote = await findVoteInMeetingOrThrow(voteId, meetingId, orgId, tx);

        // Load quorum threshold from org
        const [org] = await tx
          .select({ quorumThreshold: organizations.quorumThreshold })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        if (!org) throw AppError.notFound('Organization not found');

        // Tally ballots
        const tallyRows = await tx
          .select({ choice: ballots.choice, cnt: count() })
          .from(ballots)
          .where(eq(ballots.voteId, voteId))
          .groupBy(ballots.choice);

        const optionCounts: Record<string, number> = {};
        for (const row of tallyRows) {
          optionCounts[row.choice] = Number(row.cnt);
        }

        const [eligibilityCount] = await tx
          .select({ n: count() })
          .from(voteEligibility)
          .where(eq(voteEligibility.voteId, voteId));
        const totalEligible = Number(eligibilityCount?.n ?? 0);

        const [ballotCount] = await tx.select({ n: count() }).from(ballots).where(eq(ballots.voteId, voteId));
        const totalCast = Number(ballotCount?.n ?? 0);

        const { outcome, winner } = computeOutcome({
          options: vote.options,
          optionCounts,
          totalEligible,
          totalCast,
          quorumThreshold: Number(org.quorumThreshold),
          affirmativeOption: vote.affirmativeOption,
        });

        const resultSummary = {
          outcome,
          winner,
          totalEligible,
          totalCast,
          optionCounts,
        };

        const [closed] = await tx
          .update(votes)
          .set({ status: 'CLOSED', outcome, resultSummary, closedAt: new Date() })
          .where(and(eq(votes.id, voteId), eq(votes.status, 'OPEN')))
          .returning();

        if (!closed) throw AppError.conflict('Vote is already closed');

        await emitAudit(tx, {
          orgId,
          actorId: userId,
          event: 'vote.closed',
          entityType: 'vote',
          entityId: voteId,
          payload: { before: { status: 'OPEN' }, after: { status: 'CLOSED', outcome } },
        });

        return closed;
      });
    },

    async listVotes(
      orgId: string,
      meetingId: string,
      query: ListVotesQuery,
    ): Promise<CursorPage<Record<string, unknown>>> {
      await findMeetingInOrgOrThrow(meetingId, orgId);

      const limit = Math.min(query.limit ?? VOTES_PAGE_SIZE_DEFAULT, VOTES_PAGE_SIZE_MAX);
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

      const conditions = [eq(votes.meetingId, meetingId)];
      if (query.status) conditions.push(eq(votes.status, query.status));

      const keysetWhere = applyKeysetWhere(votes.createdAt, votes.id, cursor, 'asc');
      if (keysetWhere) conditions.push(keysetWhere);

      const rows = await db.query.votes.findMany({
        where: and(...conditions),
        limit: limit + 1,
        orderBy: (v, { asc }) => [asc(v.createdAt), asc(v.id)],
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

      const itemsWithoutChoices = items.map((v) => {
        const result: Record<string, unknown> = { ...v };
        delete result['resultSummary'];
        return result;
      });

      return { items: itemsWithoutChoices, nextCursor };
    },

    async getVote(orgId: string, meetingId: string, voteId: string) {
      const vote = await findVoteInMeetingOrThrow(voteId, meetingId, orgId);

      const [eligibilityCount] = await db
        .select({ n: count() })
        .from(voteEligibility)
        .where(eq(voteEligibility.voteId, voteId));
      const eligibleCount = Number(eligibilityCount?.n ?? 0);

      const [ballotCount] = await db.select({ n: count() }).from(ballots).where(eq(ballots.voteId, voteId));
      const totalCast = Number(ballotCount?.n ?? 0);

      const { resultSummary, ...voteData } = vote;
      return { ...voteData, eligibleCount, totalCast, resultSummary };
    },
  };
};
