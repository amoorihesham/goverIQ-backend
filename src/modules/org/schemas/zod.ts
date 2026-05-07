import { object, url, string } from 'zod';

export const createOrganizationSchema = {
  body: object({
    name: string().min(4, 'Organization name must be at least 4 characters.'),
    description: string().optional(),
    logo: url().optional(),
  }),
};

export const getOrganizationSchema = {
  params: object({
    orgId: string().min(32, 'Organization id must be set.'),
  }),
};

export const updateOrganizationSchema = {
  body: object({
    name: string().optional(),
    description: string().optional(),
    logo: url().optional(),
  }),
  params: getOrganizationSchema.params,
};
