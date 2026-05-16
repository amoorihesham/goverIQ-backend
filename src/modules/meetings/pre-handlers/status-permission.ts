import type { FastifyRequest } from 'fastify';

import { requirePermission } from '@/shared/permissions/guard';

export async function requireStatusTransitionPermission(req: FastifyRequest) {
  const target = (req.body as { status?: string })?.status;
  const key = target === 'CANCELLED' ? 'meeting:cancel' : 'meeting:update';
  return requirePermission(key)(req);
}
