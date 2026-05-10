export type SortDirection = 'asc' | 'desc';
export interface CursorPayload {
  createdAt: Date;
  id: string;
}
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
