import { eq } from 'drizzle-orm';
import { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { organizations } from '@/db/schema/org';
import { db } from '@/shared/database/client';
import { AppError } from '@/shared/errors/http-error';
import { contextFromRequest } from '@/shared/http/context';

export type OnboardingTier = 'always' | 'role_creation' | 'invitation' | 'complete';

export function requireOnboardingStep(tier: OnboardingTier): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const { orgId } = contextFromRequest(request);

    if (!orgId) throw AppError.validationError('Organization ID required');

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { onboardingStep: true, archivedAt: true },
    });

    if (!org) throw AppError.notFound('Organization not found');

    if (org.archivedAt) throw AppError.orgArchived();

    const tierGate: Record<OnboardingTier, Record<string, boolean>> = {
      always: {
        PENDING_ROLES: true,
        PENDING_INVITES: true,
        COMPLETE: true,
      },
      role_creation: {
        PENDING_ROLES: true,
        PENDING_INVITES: false,
        COMPLETE: true,
      },
      invitation: {
        PENDING_ROLES: false,
        PENDING_INVITES: true,
        COMPLETE: true,
      },
      complete: {
        PENDING_ROLES: false,
        PENDING_INVITES: false,
        COMPLETE: true,
      },
    };

    if (!tierGate[tier][org.onboardingStep])
      throw AppError.forbidden(`Action not permitted at this onboarding stage ${org.onboardingStep}`);
  };
}
