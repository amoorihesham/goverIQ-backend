import z from 'zod';

export const invitionsRequestSchema = {
  params: z.object({
    orgId: z.string(),
  }),
  body: z.object({
    email: z.email(),
    roleId: z.string(),
  }),
};

export const listMembersRequestSchema = {
  params: z.object({
    orgId: z.string(),
  }),
};

export const removeMemberRequestSchema = {
  params: z.object({
    orgId: z.string(),
    memberId: z.string(),
  }),
};

export const asignMemberRoleRequestSchema = {
  params: z.object({
    orgId: z.string(),
    memberId: z.string(),
  }),
  body: z.object({
    roleId: z.string(),
  }),
};

export const revokeMemberRoleRequestSchema = {
  params: z.object({
    orgId: z.string(),
    memberId: z.string(),
  }),
};
export const removeMemberFromOrgRequest = {
  params: { orgId: z.string(), memberId: z.string() },
};

export const revokeMemberRole = removeMemberFromOrgRequest;
