import { z } from 'zod';

import { createVoteSchema, castBallotSchema, listVotesSchema } from '../schemas/zod';

export type CreateVoteBody = z.infer<typeof createVoteSchema.body>;
export type CastBallotBody = z.infer<typeof castBallotSchema.body>;
export type ListVotesQuery = z.infer<typeof listVotesSchema.querystring>;
