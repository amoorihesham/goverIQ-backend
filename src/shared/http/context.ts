import { FastifyRequest } from 'fastify';

export interface RequestContext {
  reqId: string;
  userId?: string;
  orgId?: string;
}
export function contextFromRequest(req: FastifyRequest): RequestContext {
  return {
    reqId: req.id,
    orgId: req.orgId,
    userId: req.user?.userId,
  };
}
