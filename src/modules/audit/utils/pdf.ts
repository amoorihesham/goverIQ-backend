import PDFDocument from 'pdfkit';

export interface AuditPdfRow {
  id: string;
  actorId: string | null;
  event: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  createdAt: Date;
}

export function renderAuditPdf(orgId: string, rows: AuditPdfRow[], stream: NodeJS.WritableStream): void {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(stream);

  doc.fontSize(16).text(`Audit Log — Organisation ${orgId}`, { align: 'center' });
  doc.fontSize(10).text(`Exported: ${new Date().toISOString()}`, { align: 'center' });
  doc.moveDown();

  if (rows.length === 0) {
    doc.fontSize(11).text('No audit entries match the applied filters.');
  } else {
    for (const row of rows) {
      doc
        .fontSize(9)
        .text(`[${row.createdAt.toISOString()}] ${row.event}  (${row.entityType})`)
        .text(`  id: ${row.id}  actor: ${row.actorId ?? '-'}  entity: ${row.entityId ?? '-'}`)
        .text(`  payload: ${JSON.stringify(row.payload)}`)
        .moveDown(0.4);
    }
  }

  doc.end();
}
