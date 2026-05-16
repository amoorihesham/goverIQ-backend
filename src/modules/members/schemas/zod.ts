import { string, object } from 'zod';

export const getMembersInOrganizationRequestSchema = {
  summary: 'Get all members in organization.',
  params: object({
    orgId: string(),
  }),
};

export const getMemberDetailsRequestSchema = {
  summary: 'Get member details in organization.',
  params: object({
    orgId: string(),
    memberId: string(),
  }),
};

export const removeMemberRequestSchema = {
  summary: 'Remove member from organization.',
  params: object({
    orgId: string(),
    memberId: string(),
  }),
};

export const asignMemberRoleRequestSchema = {
  summary: 'Assign a role to member in organization.',
  params: object({
    orgId: string(),
    memberId: string(),
  }),
  body: object({
    roleId: string(),
  }),
};

export const revokeMemberRoleRequestSchema = {
  summary: 'Revoke member role in organization.',
  params: object({
    orgId: string(),
    memberId: string(),
  }),
};
