import { z, object, string, array } from 'zod';

export const createVoteSchema = {
  summary: 'Create a vote',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
  body: object({
    question: string().min(1),
    options: array(string().min(1))
      .min(2)
      .refine((opts) => new Set(opts).size === opts.length, {
        message: 'options must be distinct',
      }),
    affirmativeOption: string().min(1),
    deadline: string().datetime().optional(),
    eligibleMemberIds: array(string().uuid()).min(1).nullable().optional(),
  }).refine((body) => body.options.includes(body.affirmativeOption), {
    message: 'affirmativeOption must be one of the options',
    path: ['affirmativeOption'],
  }),
};

export const castBallotSchema = {
  summary: 'Cast a ballot in a vote',
  params: object({ voteId: string().uuid(), meetingId: string().uuid(), orgId: string().uuid() }),
  body: object({
    choice: string().min(1),
  }),
};

export const closeVoteSchema = {
  summary: 'Close a vote',
  params: object({ voteId: string().uuid(), meetingId: string().uuid(), orgId: string().uuid() }),
};

export const listVotesSchema = {
  summary: 'List votes for a meeting',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
  querystring: object({
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    cursor: string().optional(),
    limit: z.coerce.number().int().positive().optional(),
  }),
};

export const getVoteSchema = {
  summary: 'Get a single vote',
  params: object({ voteId: string().uuid(), meetingId: string().uuid(), orgId: string().uuid() }),
};
