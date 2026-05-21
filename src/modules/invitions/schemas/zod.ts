import { email, object, string } from 'zod';

export const listInvitionsSchema = {
  summary: 'List all organization invitations.',
  params: object({
    orgId: string(),
  }),
};

export const getInvitationSchema = {
  summary: 'Get single invitaion deltails.',
  params: object({
    orgId: string(),
    invitationId: string(),
  }),
};

export const createInvitationSchema = {
  summary: 'Create new invitation.',
  params: object({ orgId: string() }),
  body: object({
    email: email(),
    roleId: string(),
  }),
};

export const deleteInvitationSchema = {
  summary: 'Delete invitation.',
  params: object({
    invitationId: string(),
    orgId: string(),
  }),
};

export const acceptInvitationSchema = {
  summary: 'Accept an invitation by token.',
  params: object({
    token: string().length(64).regex(/^[a-f0-9]+$/),
  }),
  body: object({
    password: string().min(12).optional(),
  }),
};

export const declineInvitationSchema = {
  summary: 'Decline an invitation by token.',
  params: object({
    token: string().length(64).regex(/^[a-f0-9]+$/),
  }),
};
