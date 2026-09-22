export type WFHDuration = 'full-day' | 'half-day';
export type WFHHalf = 'first-half' | 'second-half';

export interface ExistingWFHSlot {
  wfhDuration?: WFHDuration | null;
  halfDayType?: WFHHalf | null;
}

/** Historical records without a duration are full-day requests. */
export function normalizeWFHDuration(duration?: WFHDuration | null): WFHDuration {
  return duration === 'half-day' ? 'half-day' : 'full-day';
}

/** The server owns the amount reserved or consumed from the balance. */
export function getRequestedWFHDays(duration: WFHDuration, fullDayCount: number): number {
  return duration === 'half-day' ? 0.5 : fullDayCount;
}

/**
 * Product policy allows only one WFH request per date. Two half requests must
 * be represented by a single full-day request.
 */
export function getWFHOverlapConflict(
  existing: ExistingWFHSlot,
  requestedDuration: WFHDuration,
  requestedHalf?: WFHHalf,
  conflictDate?: string
): string {
  const existingDuration = normalizeWFHDuration(existing.wfhDuration);
  const dateText = conflictDate ? ` for ${conflictDate}` : ' for the selected date';
  const halfLabel = (half?: WFHHalf | null) =>
    half === 'first-half' ? 'First Half' : half === 'second-half' ? 'Second Half' : 'Half Day';

  if (existingDuration === 'half-day') {
    if (requestedDuration === 'half-day') {
      if (existing.halfDayType === requestedHalf) {
        return `Duplicate WFH request: an active ${halfLabel(requestedHalf)} WFH request already exists${dateText}.`;
      }
      return `An active ${halfLabel(existing.halfDayType)} WFH request already exists${dateText}. You cannot submit a separate ${halfLabel(requestedHalf)} WFH request for the same date; cancel the existing request and apply for Full Day WFH instead.`;
    }

    return `An active ${halfLabel(existing.halfDayType)} WFH request already exists${dateText}. Cancel it before submitting a Full Day WFH request for the same date.`;
  }

  const coveredDateText = conflictDate ? ` ${conflictDate}` : ' the selected date';
  return `An active Full Day WFH request already covers${coveredDateText}. Another WFH request cannot be submitted for this date.`;
}
