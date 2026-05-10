import { describe, it, expect } from 'vitest';

import { assertNoPrivilegeEscalation } from '@/modules/roles/utils/privilege';
import { AppError } from '@/shared/errors/http-error';

describe('privilege utilities', () => {
  describe('assertNoPrivilegeEscalation', () => {
    it('should pass when requested permissions are empty', () => {
      expect(() => assertNoPrivilegeEscalation(['perm1', 'perm2'], [])).not.toThrow();
    });

    it('should pass when requested permissions are strict subset', () => {
      expect(() =>
        assertNoPrivilegeEscalation(['perm1', 'perm2', 'perm3'], ['perm1', 'perm3']),
      ).not.toThrow();
    });

    it('should pass when requested permissions exactly match', () => {
      expect(() =>
        assertNoPrivilegeEscalation(['perm1', 'perm2'], ['perm1', 'perm2']),
      ).not.toThrow();
    });

    it('should throw PRIVILEGE_ESCALATION when missing permission', () => {
      expect(() => assertNoPrivilegeEscalation(['perm1', 'perm2'], ['perm1', 'perm3'])).toThrow(
        AppError,
      );

      try {
        assertNoPrivilegeEscalation(['perm1', 'perm2'], ['perm1', 'perm3']);
      } catch (error: any) {
        expect(error.code).toBe('PRIVILEGE_ESCALATION');
      }
    });

    it('should throw PRIVILEGE_ESCALATION when requested set is superset', () => {
      expect(() => assertNoPrivilegeEscalation(['perm1'], ['perm1', 'perm2'])).toThrow(AppError);

      try {
        assertNoPrivilegeEscalation(['perm1'], ['perm1', 'perm2']);
      } catch (error: any) {
        expect(error.code).toBe('PRIVILEGE_ESCALATION');
      }
    });

    it('should throw PRIVILEGE_ESCALATION when caller has no permissions', () => {
      expect(() => assertNoPrivilegeEscalation([], ['perm1'])).toThrow(AppError);

      try {
        assertNoPrivilegeEscalation([], ['perm1']);
      } catch (error: any) {
        expect(error.code).toBe('PRIVILEGE_ESCALATION');
      }
    });

    it('should pass when requested is empty regardless of caller permissions', () => {
      expect(() => assertNoPrivilegeEscalation([], [])).not.toThrow();
    });
  });
});
