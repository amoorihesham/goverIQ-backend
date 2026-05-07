import type { FastifyInstance } from 'fastify';

import { orgRoutes } from './org.routes';
import { roleRoutes } from './role.routes';
import { memberRoutes } from './member.routes';
import { MemberController } from './member.controller';

export async function orgPlugin(fastify: FastifyInstance) {
  await fastify.register(orgRoutes);
  await fastify.register(roleRoutes);
  await fastify.register(memberRoutes);
}

export async function invitationsPublicPlugin(fastify: FastifyInstance) {
  // POST /invitations/:token/accept - Accept invitation (public, no auth)
  fastify.post<{ Params: { token: string }; Body: { password?: string } }>(
    '/invitations/:token/accept',
    MemberController.acceptInvitation,
  );

  // POST /invitations/:token/decline - Decline invitation (public, no auth)
  fastify.post<{ Params: { token: string } }>(
    '/invitations/:token/decline',
    MemberController.declineInvitation,
  );
}
