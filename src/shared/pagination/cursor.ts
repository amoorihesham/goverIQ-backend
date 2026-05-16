import { and, eq, gt, lt, or, SQL } from 'drizzle-orm';
import { AnyPgColumn } from 'drizzle-orm/pg-core';

import { AppError } from '../errors/http-error';

import { cursorSchema } from './cursor-schema';
import { CursorPayload, SortDirection } from './types';

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  const obj = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  const { success, data } = cursorSchema.safeParse(obj);
  if (!success) throw AppError.validationError('invalid cursor');

  return data;
}

export function applyKeysetWhere(
  createdAtCol: AnyPgColumn,
  idCol: AnyPgColumn,
  cursor: CursorPayload | undefined,
  direction: SortDirection,
): SQL | undefined {
  if (!cursor) return undefined;

  const cmpOp = direction === 'asc' ? gt : lt;

  return or(cmpOp(createdAtCol, cursor.createdAt), and(eq(createdAtCol, cursor.createdAt), cmpOp(idCol, cursor.id)));
}
