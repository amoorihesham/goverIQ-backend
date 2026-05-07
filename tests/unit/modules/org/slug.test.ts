import { describe, it, expect } from 'vitest';

import { generateSlug, ensureUniqueSlug } from '@/modules/org/slug';

// Mock database for slug tests
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => [],
      }),
    }),
  }),
};

describe('slug utilities', () => {
  describe('generateSlug', () => {
    it('should generate a basic slug', () => {
      expect(generateSlug('Test Organization')).toBe('test-organization');
    });

    it('should handle special characters', () => {
      expect(generateSlug('Test & Co.')).toBe('test-co');
    });

    it('should handle leading and trailing spaces', () => {
      expect(generateSlug('  Test Org  ')).toBe('test-org');
    });

    it('should handle multiple consecutive spaces', () => {
      expect(generateSlug('Test   Org')).toBe('test-org');
    });

    it('should handle underscores', () => {
      expect(generateSlug('Test_Org')).toBe('test-org');
    });

    it('should handle numbers', () => {
      expect(generateSlug('Test 123')).toBe('test-123');
    });

    it('should handle empty string', () => {
      expect(generateSlug('')).toBe('');
    });
  });

  describe('ensureUniqueSlug', () => {
    it('should return base slug when no collision', async () => {
      const slug = await ensureUniqueSlug(mockDb as any, 'test-org');
      expect(slug).toBe('test-org');
    });

    it('should add numeric suffix when collision occurs', async () => {
      // Mock database to simulate slug collision
      const mockDbWithCollision = {
        select: () => ({
          from: () => ({
            where: (condition: any) => {
              // Simulate that 'test-org' exists
              if (condition._left?.columnName === 'slug' && condition._right?.value === 'test-org') {
                return {
                  limit: () => [{ id: 'existing-id' }],
                };
              }
              // For other slugs, return empty array
              return {
                limit: () => [],
              };
            },
          }),
        }),
      };

      const slug = await ensureUniqueSlug(mockDbWithCollision as any, 'test-org');
      expect(slug).toBe('test-org-2');
    });

    it('should increment suffix until no collision', async () => {
      // Mock database to simulate multiple collisions
      const mockDbWithMultipleCollisions = {
        select: () => ({
          from: () => ({
            where: (condition: any) => {
              // Simulate that 'test-org', 'test-org-2', 'test-org-3' exist
              const slugValue = condition._right?.value;
              if (
                slugValue === 'test-org' ||
                slugValue === 'test-org-2' ||
                slugValue === 'test-org-3'
              ) {
                return {
                  limit: () => [{ id: 'existing-id' }],
                };
              }
              // For 'test-org-4', return empty array
              return {
                limit: () => [],
              };
            },
          }),
        }),
      };

      const slug = await ensureUniqueSlug(mockDbWithMultipleCollisions as any, 'test-org');
      expect(slug).toBe('test-org-4');
    });

    it('should use random fallback after max suffix attempts', async () => {
      // Mock database to simulate many collisions
      const mockDbWithManyCollisions = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => [{ id: 'existing-id' }], // Always return collision
            }),
          }),
        }),
      };

      const slug = await ensureUniqueSlug(mockDbWithManyCollisions as any, 'test-org');
      expect(slug).toMatch(/^test-org-[a-f0-9]{4}$/); // Should be test-org-xxxx format (4 hex chars)
    });
  });
});