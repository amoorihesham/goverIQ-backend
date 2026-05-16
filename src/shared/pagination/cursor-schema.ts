import { coerce, object, string, uuid } from 'zod';

export const cursorSchema = object({
  createdAt: coerce.date(),
  id: uuid(),
});

export const paginationQuerySchema = object({
  cursor: string().optional(),
  limit: coerce.number().int().min(1).max(100).default(20),
});
