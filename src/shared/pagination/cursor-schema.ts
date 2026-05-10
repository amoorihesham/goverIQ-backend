import { coerce, date, object, string, uuid } from 'zod';

export const cursorSchema = object({
  createdAt: date(),
  id: uuid(),
});

export const paginationQuerySchema = object({
  cursor: string().optional(),
  limit: coerce.number().int().min(1).max(100).default(20),
});
