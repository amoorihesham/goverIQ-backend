import { string, object } from 'zod';

export const getMembersInOrganizationRequestSchema = {
  params: object({
    orgId: string(),
  }),
};

export const getMemberDetailsRequestSchema = {
  params: object({
    orgId: string(),
    memberId: string(),
  }),
};
export const updateMemberRequestSchema = {
  params: object({
    orgId: string(),
    memberId: string(),
  }),
  body: object({
    roleId: string(),
  }),
};

export const listMembersRequestSchema = {
  params: object({
    orgId: string(),
  }),
};

export const removeMemberRequestSchema = {
  params: object({
    orgId: string(),
    memberId: string(),
  }),
};

export const asignMemberRoleRequestSchema = {
  params: object({
    orgId: string(),
    memberId: string(),
  }),
  body: object({
    roleId: string(),
  }),
};

export const revokeMemberRoleRequestSchema = {
  params: object({
    orgId: string(),
    memberId: string(),
  }),
};
export const removeMemberFromOrgRequest = {
  params: { orgId: string(), memberId: string() },
};

export const revokeMemberRole = removeMemberFromOrgRequest;
