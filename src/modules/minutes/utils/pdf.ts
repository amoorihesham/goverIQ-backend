import PDFDocument from 'pdfkit';

interface Meeting {
  id: string;
  title: string;
  scheduledAt: Date;
  orgId: string;
}

interface MinutesDoc {
  id: string;
  meetingId: string;
  summary: string | null;
  attendanceNotes: string | null;
  status: string;
  finalizedAt: Date | null;
  createdAt: Date;
}

interface Resolution {
  id: string;
  voteId: string;
  description: string;
  createdAt: Date;
}

interface Correction {
  id: string;
  content: string;
  createdAt: Date;
}

interface PdfInput {
  meeting: Meeting;
  minutes: MinutesDoc;
  resolutions: Resolution[];
  corrections: Correction[];
}

export function renderMinutesPdf(input: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { meeting, minutes, resolutions, corrections } = input;
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(20).text('Meeting Minutes', { align: 'center' });
    doc.moveDown();

    // Meeting details
    doc.fontSize(14).text('Meeting Details');
    doc
      .fontSize(11)
      .text(`Title: ${meeting.title}`)
      .text(`Date: ${meeting.scheduledAt.toISOString().split('T')[0]}`)
      .text(`Status: ${minutes.status}`)
      .text(`Finalized: ${minutes.finalizedAt ? minutes.finalizedAt.toISOString() : 'N/A'}`);
    doc.moveDown();

    // Summary
    doc.fontSize(14).text('Summary');
    doc.fontSize(11).text(minutes.summary || '(no summary)');
    doc.moveDown();

    // Attendance notes
    doc.fontSize(14).text('Attendance Notes');
    doc.fontSize(11).text(minutes.attendanceNotes || '(no attendance notes)');
    doc.moveDown();

    // Resolutions
    doc.fontSize(14).text('Resolutions');
    if (resolutions.length === 0) {
      doc.fontSize(11).text('(no resolutions)');
    } else {
      for (const r of resolutions) {
        doc.fontSize(11).text(`• ${r.description}`);
      }
    }
    doc.moveDown();

    // Corrections
    doc.fontSize(14).text('Corrections');
    if (corrections.length === 0) {
      doc.fontSize(11).text('(no corrections)');
    } else {
      for (const c of corrections) {
        doc.fontSize(11).text(`[${c.createdAt.toISOString()}] ${c.content}`);
      }
    }

    doc.end();
  });
}
