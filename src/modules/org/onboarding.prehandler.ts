import { eq } from 'drizzle-orm';
import { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { organizations } from '@/db/schema/org';
import { db } from '@/shared/database/client';
import { AppError } from '@/shared/errors/http-error';

export type OnboardingTier = 'always' | 'role_creation' | 'invitation' | 'complete';

export function requireOnboardingStep(tier: OnboardingTier): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    // Read orgId from request.params
    const orgId = (request.params as Record<string, unknown>).orgId as string | undefined;

    if (!orgId) {
      throw AppError.validationError('Organization ID required');
    }

    // Query organizations table for onboardingStep and archivedAt
    const orgResults = await db
      .select({
        onboardingStep: organizations.onboardingStep,
        archivedAt: organizations.archivedAt,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!orgResults.length || !orgResults[0]) {
      throw AppError.notFound('Organization not found');
    }

    const { onboardingStep, archivedAt } = orgResults[0];

    // Check if org is archived
    if (archivedAt) {
      throw AppError.orgArchived();
    }

    // Evaluate tier gate logic
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

    if (!tierGate[tier][onboardingStep]) {
      throw AppError.forbidden('Action not permitted at this onboarding stage');
    }
  };
}
