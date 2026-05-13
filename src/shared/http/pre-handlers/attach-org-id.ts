import { preHandlerHookHandler } from 'fastify';

import { AppError } from '@/shared/errors/http-error';

export const attachOrgId: preHandlerHookHandler = async (request) => {
  const { orgId } = request.params as { orgId?: string };
  if (!orgId) throw AppError.validationError('Organization ID required');
  request.orgId = orgId;
};
