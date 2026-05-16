import { object, url, string } from 'zod';

export const createOrganizationSchema = {
  summary: 'Create new organization.',
  body: object({
    name: string().min(4, 'Organization name must be at least 4 characters.'),
    description: string().optional(),
    logo: url().optional(),
  }),
};

export const getOrganizationSchema = {
  summary: 'Get organization deltails.',
  params: object({
    orgId: string().min(32, 'Organization id must be set.'),
  }),
};

export const updateOrganizationSchema = {
  summary: 'Update organization data.',
  body: object({
    name: string().optional(),
    description: string().optional(),
    logo: url().optional(),
  }),
  params: getOrganizationSchema.params,
};
