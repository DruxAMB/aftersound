/**
 * NIOSH noise exposure calculations.
 *
 * Based on NIOSH criteria document DHHS 98-126 (public domain):
 * - Recommended Exposure Limit (REL): 85 dBA for 8 hours
 * - Exchange rate: 3 dB (each 3 dB increase halves the allowed time)
 * - Reference: https://www.cdc.gov/niosh/docs/98-126/
 *
 * T_allowed(L) = 8 / 2^((L - 85) / 3)  hours
 *
 * At 85 dBA: 8h allowed  (100% dose for 8h exposure)
 * At 88 dBA: 4h allowed
 * At 91 dBA: 2h allowed
 * At 94 dBA: 1h allowed
 */

export const NIOSH_REL = 85; // dBA, 8-hour recommended exposure limit
export const NIOSH_EXCHANGE_RATE = 3; // dB
export const NIOSH_REF_HOURS = 8; // hours at REL

/**
 * Allowed exposure time at a given A-weighted level.
 * Returns hours. Below 80 dBA, returns Infinity (effectively unlimited).
 */
export function allowedTime(laeq: number): number {
  if (laeq < 80) return Infinity;
  const hours = NIOSH_REF_HOURS / Math.pow(2, (laeq - NIOSH_REL) / NIOSH_EXCHANGE_RATE);
  return hours;
}

/**
 * NIOSH daily dose percentage for a given level and exposure duration.
 * 100% = at the REL (85 dBA for 8h).
 */
export function dosePercent(laeq: number, hours: number): number {
  if (laeq < 80) return 0;
  const tAllowed = allowedTime(laeq);
  return (100 * hours) / tAllowed;
}

/**
 * Format hours as "Xh YYm" string.
 * Handles Infinity (returns "unlimited") and values < 1 minute.
 */
export function formatDuration(hours: number): string {
  if (!isFinite(hours)) return "unlimited";
  if (hours <= 0) return "0m";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
