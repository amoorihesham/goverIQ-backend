export interface AuditCsvRow {
  id: string;
  actorId: string | null;
  event: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  createdAt: Date;
}

const HEADERS = ['id', 'actorId', 'event', 'entityType', 'entityId', 'payload', 'createdAt'];

function quoteField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsv(row: AuditCsvRow): string {
  const fields = [
    row.id,
    row.actorId ?? '',
    row.event,
    row.entityType,
    row.entityId ?? '',
    JSON.stringify(row.payload),
    row.createdAt.toISOString(),
  ];
  return fields.map(quoteField).join(',');
}

export function renderAuditCsv(rows: AuditCsvRow[], stream: NodeJS.WritableStream): void {
  stream.write(HEADERS.join(',') + '\r\n');
  for (const row of rows) {
    stream.write(rowToCsv(row) + '\r\n');
  }
}
