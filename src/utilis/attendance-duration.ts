/**
 * Returns the expected work duration for a shift. Half-day leave reduces only
 * the duration requirement; it never imposes a fixed clock-time boundary.
 */
export function getExpectedWorkMinutes(
  shiftStart: Date,
  shiftEnd: Date,
  isHalfDayLeave = false
): number {
  const fullDayMinutes = Math.max(
    0,
    (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60)
  );

  return isHalfDayLeave ? fullDayMinutes * 0.5 : fullDayMinutes;
}
