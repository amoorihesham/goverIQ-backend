export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

export function getConstraintName(err: unknown): string | undefined {
  return (err as { constraint?: string }).constraint;
}
