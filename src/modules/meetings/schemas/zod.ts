import { z, object, string, array, number, coerce } from 'zod';

const agendaItemSchema = object({
  title: string().min(1),
  description: string().optional(),
  orderIndex: number().int().nonnegative(),
});

const agendaItemsSchema = array(agendaItemSchema).refine(
  (items) => new Set(items.map((item) => item.orderIndex)).size === items.length,
  { message: 'agenda item orderIndex values must be unique within a meeting' },
);

export const createMeetingSchema = {
  summary: 'Create a meeting',
  params: object({ orgId: string() }),
  body: object({
    title: string().min(1),
    description: string().optional(),
    location: string().optional(),
    scheduledAt: string()
      .datetime()
      .refine((v) => new Date(v) > new Date(), {
        message: 'scheduledAt must be in the future',
      }),
    agendaItems: agendaItemsSchema.optional(),
  }),
};

export const transitionStatusSchema = {
  summary: 'Transition meeting status',
  params: object({ meetingId: string(), orgId: string() }),
  body: object({
    status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  }),
};

export const addAttendeesSchema = {
  summary: 'Add attendees to a meeting',
  params: object({ meetingId: string(), orgId: string() }),
  body: object({
    memberIds: array(string().uuid()).min(1),
  }),
};

export const removeAttendeeSchema = {
  summary: 'Remove an attendee from a meeting',
  params: object({ meetingId: string(), orgId: string(), memberId: string().uuid() }),
};

export const listMeetingsSchema = {
  summary: 'List meetings in an organization',
  params: object({ orgId: string() }),
  querystring: object({
    status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    from: string().datetime().optional(),
    to: string().datetime().optional(),
    attendeeId: string().uuid().optional(),
    cursor: string().optional(),
    limit: coerce.number().int().positive().optional(),
  }),
};

export const getMeetingSchema = {
  summary: 'Get meeting detail',
  params: object({ meetingId: string(), orgId: string() }),
};

export const updateMeetingSchema = {
  summary: 'Update meeting details',
  params: object({ meetingId: string(), orgId: string() }),
  body: object({
    title: string().min(1).optional(),
    description: string().nullable().optional(),
    location: string().nullable().optional(),
    scheduledAt: string()
      .datetime()
      .refine((v) => new Date(v) > new Date(), {
        message: 'scheduledAt must be in the future',
      })
      .optional(),
    agendaItems: agendaItemsSchema.optional(),
  }),
};
