// PostgreSQL error code for unique constraint violations (SQLSTATE 23505).
// Both the pg and @neondatabase/serverless drivers surface this as err.code.
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

export function getConstraintName(err: unknown): string | undefined {
  return (err as { constraint?: string }).constraint;
}
