import { infer as zInfer } from 'zod';

import {
  asignMemberRoleRequestSchema,
  invitionsRequestSchema,
  listMembersRequestSchema,
  removeMemberFromOrgRequest,
  removeMemberRequestSchema,
  revokeMemberRoleRequestSchema,
} from '../schemas/zod';

export type InviteMemberRequestBody = zInfer<(typeof invitionsRequestSchema)['body']>;
export type MemberRequestWithOrgIdParam = zInfer<(typeof invitionsRequestSchema)['params']>;
export type RequestWithOrgIdAndMemberIdParams = zInfer<(typeof removeMemberFromOrgRequest)['params']>;
export type ListMembersRequest = zInfer<(typeof listMembersRequestSchema)['params']>;
export type RemoveMembersRequest = zInfer<(typeof removeMemberRequestSchema)['params']>;
export type AsignMemberRoleRequestParams = zInfer<(typeof asignMemberRoleRequestSchema)['params']>;
export type AsignMemberRoleRequestBody = zInfer<(typeof asignMemberRoleRequestSchema)['body']>;
export type RevokeMemberRoleRequest = zInfer<(typeof revokeMemberRoleRequestSchema)['params']>;
