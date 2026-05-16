import { z } from 'zod';

import {
  createMeetingSchema,
  transitionStatusSchema,
  addAttendeesSchema,
  listMeetingsSchema,
  updateMeetingSchema,
} from '../schemas/zod';

export type CreateMeetingBody = z.infer<typeof createMeetingSchema.body>;
export type TransitionStatusBody = z.infer<typeof transitionStatusSchema.body>;
export type AddAttendeesBody = z.infer<typeof addAttendeesSchema.body>;
export type ListMeetingsQuery = z.infer<typeof listMeetingsSchema.querystring>;
export type UpdateMeetingBody = z.infer<typeof updateMeetingSchema.body>;
