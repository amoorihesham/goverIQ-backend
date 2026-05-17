import { object, string } from 'zod';

export const createMinutesSchema = {
  summary: 'Create minutes for a completed meeting',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
  body: object({
    summary: string().optional(),
    attendanceNotes: string().optional(),
  }),
};

export const editMinutesSchema = {
  summary: 'Edit draft minutes',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
  body: object({
    summary: string().optional(),
    attendanceNotes: string().optional(),
  }).refine((b) => b.summary !== undefined || b.attendanceNotes !== undefined, {
    message: 'At least one of summary or attendanceNotes must be provided',
  }),
};

export const attachResolutionSchema = {
  summary: 'Attach a resolution to draft minutes',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
  body: object({
    voteId: string().uuid(),
    description: string().min(1),
  }),
};

export const finalizeMinutesSchema = {
  summary: 'Finalize minutes',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
};

export const appendCorrectionSchema = {
  summary: 'Append a correction to finalized minutes',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
  body: object({
    content: string().min(1),
  }),
};

export const readMinutesSchema = {
  summary: 'Read minutes for a meeting',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
};

export const exportMinutesSchema = {
  summary: 'Export minutes as PDF',
  params: object({ meetingId: string().uuid(), orgId: string().uuid() }),
};
