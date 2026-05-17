import { AppError } from '@/shared/errors/http-error';

export function assertNoPrivilegeEscalation(callerPermissions: string[], requestedPermissions: string[]): void {
  const callerSet = new Set(callerPermissions);

  for (const permission of requestedPermissions) {
    if (!callerSet.has(permission)) {
      throw AppError.privilegeEscalation();
    }
  }
}
