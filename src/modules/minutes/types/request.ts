import { z } from 'zod';

import { createMinutesSchema, editMinutesSchema, attachResolutionSchema, appendCorrectionSchema } from '../schemas/zod';

export type CreateMinutesBody = z.infer<typeof createMinutesSchema.body>;
export type EditMinutesBody = z.infer<typeof editMinutesSchema.body>;
export type AttachResolutionBody = z.infer<typeof attachResolutionSchema.body>;
export type AppendCorrectionBody = z.infer<typeof appendCorrectionSchema.body>;
