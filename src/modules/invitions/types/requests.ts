import { infer as zInfer } from 'zod';

import {
  createInvitationSchema,
  deleteInvitationSchema,
  getInvitationSchema,
  listInvitionsSchema,
} from '../schemas/zod';

export type ListInvitionsRequestParams = zInfer<(typeof listInvitionsSchema)['params']>;
export type GetInvitationRequestParams = zInfer<(typeof getInvitationSchema)['params']>;
export type CreateInvitationRequestBody = zInfer<(typeof createInvitationSchema)['body']>;
export type DeleteInvitationRequestParams = zInfer<(typeof deleteInvitationSchema)['params']>;
