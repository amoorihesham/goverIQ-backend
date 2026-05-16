import type { meetingStatusEnum } from '@/db/schema/meeting';
import { AppError } from '@/shared/errors/http-error';

export type MeetingStatus = (typeof meetingStatusEnum.enumValues)[number];

export const MEETING_TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  DRAFT: ['SCHEDULED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertValidTransition(from: MeetingStatus, to: MeetingStatus): void {
  if (!MEETING_TRANSITIONS[from].includes(to)) {
    throw AppError.invalidStateTransition(`Cannot transition meeting from ${from} to ${to}`);
  }
}
