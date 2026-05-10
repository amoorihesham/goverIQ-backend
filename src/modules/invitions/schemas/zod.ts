import { email, object, string } from 'zod';

export const listInvitionsSchema = {
  params: object({
    orgId: string(),
  }),
};

export const getInvitationSchema = {
  params: object({
    orgId: string(),
    invitationId: string(),
  }),
};

export const createInvitationSchema = {
  body: object({
    orgId: string(),
    email: email(),
    roleId: string(),
  }),
};

export const deleteInvitationSchema = {
  params: object({
    invitationId: string(),
  }),
};
