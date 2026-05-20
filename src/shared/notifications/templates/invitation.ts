export interface InvitationPayload {
  orgName: string;
  acceptUrl: string;
  declineUrl: string;
  expiresAt: Date;
}

export function buildInvitationEmail(payload: InvitationPayload): {
  subject: string;
  text: string;
} {
  return {
    subject: `You've been invited to ${payload.orgName}`,
    text: `
You have been invited to join ${payload.orgName}.

Accept invitation:
${payload.acceptUrl}

Decline invitation:
${payload.declineUrl}

This invitation expires at ${payload.expiresAt.toLocaleDateString()}.

If you did not expect this invitation, please decline it or contact the organization administrator.
`.trim(),
  };
}
