import { infer as zInfer } from 'zod';

import {
  asignMemberRoleRequestSchema,
  getMemberDetailsRequestSchema,
  getMembersInOrganizationRequestSchema,
  removeMemberRequestSchema,
  revokeMemberRoleRequestSchema,
} from '../schemas/zod';

export type GetMembersInOrganizationRequestParams = zInfer<(typeof getMembersInOrganizationRequestSchema)['params']>;
export type GetMemberDetailsRequestParams = zInfer<(typeof getMemberDetailsRequestSchema)['params']>;
export type AsignMemberRoleRequestParams = zInfer<(typeof asignMemberRoleRequestSchema)['params']>;
export type AsignMemberRoleRequestBody = zInfer<(typeof asignMemberRoleRequestSchema)['body']>;
export type RevokeMemberRoleRequestParams = zInfer<(typeof revokeMemberRoleRequestSchema)['params']>;
export type RemoveMemberRequestParams = zInfer<(typeof removeMemberRequestSchema)['params']>;
