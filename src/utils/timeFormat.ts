/**
 * Consistent 12-hour (AM/PM) time formatting utilities for Study Buddy AI.
 * Keeps stored canonical 24-hour ("HH:mm") strings and ISO timestamps intact
 * for chronological sorting and timezone accuracy while displaying clear AM/PM times.
 */

export interface Time12Parts {
  hour12: number; // 1..12
  minute: string; // "00".."59"
  period: 'AM' | 'PM';
}

/**
 * Converts a single 24-hour time string (e.g. "00:00", "12:00", "15:30", "18:45")
 * into 12-hour AM/PM format ("12:00 AM", "12:00 PM", "3:30 PM", "6:45 PM").
 * If the string is already in 12-hour AM/PM format, normalizes spacing/casing cleanly.
 */
export function formatTime12Hour(timeStr?: string | null): string {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const trimmed = timeStr.trim();
  if (!trimmed) return '';

  // Already contains AM/PM -> normalize cleanly
  const existing12 = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (existing12) {
    let h = parseInt(existing12[1], 10);
    const m = existing12[2];
    const p = existing12[4].toUpperCase();
    if (h === 0) h = 12;
    if (h > 12) h = h % 12 || 12;
    return `${h}:${m} ${p}`;
  }

  // Standard 24-hour HH:mm or HH:mm:ss
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match24) return trimmed;

  const hours24 = parseInt(match24[1], 10);
  const minutes = match24[2];
  if (Number.isNaN(hours24) || hours24 < 0 || hours24 > 23) return trimmed;

  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${minutes} ${period}`;
}

/**
 * Formats either:
 * - Two 24-hour strings: formatTimeRange12Hour("14:30", "17:30") -> "2:30 PM – 5:30 PM"
 * - A combined range string: formatTimeRange12Hour("18:15 - 18:45") -> "6:15 PM – 6:45 PM"
 */
export function formatTimeRange12Hour(startOrRange?: string | null, endTime?: string | null): string {
  if (!startOrRange) return '';
  if (typeof endTime === 'string' && endTime.trim()) {
    return `${formatTime12Hour(startOrRange)} – ${formatTime12Hour(endTime)}`;
  }

  const trimmed = startOrRange.trim();
  // Replace any standalone 24-hour HH:mm tokens inside a range or label
  const rangeParts = trimmed.split(/\s*[-–—]\s*/);
  if (rangeParts.length === 2) {
    const startFormatted = formatTime12Hour(rangeParts[0]);
    const endFormatted = formatTime12Hour(rangeParts[1]);
    return `${startFormatted} – ${endFormatted}`;
  }

  // Fallback: convert any embedded HH:mm tokens without AM/PM
  return trimmed.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?!\s*[ap]m)\b/gi, (m) => formatTime12Hour(m));
}

/**
 * Formats a Date or ISO timestamp into explicit 12-hour AM/PM time (e.g., "3:30 PM").
 */
export function formatTimestamp12Hour(
  dateInput: Date | string | number,
  options?: { includeSeconds?: boolean }
): string {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(options?.includeSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  });
}

/**
 * Formats a Date or ISO timestamp with date + 12-hour AM/PM time (e.g., "Nov 23, 2026, 3:30 PM").
 */
export function formatDateTime12Hour(
  dateInput: Date | string | number,
  options?: { includeSeconds?: boolean }
): string {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(options?.includeSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  });
}

/**
 * Parses a canonical "HH:mm" 24-hour value into 12-hour picker parts.
 */
export function parse24To12Parts(time24: string): Time12Parts {
  const match = (time24 || '09:00').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { hour12: 9, minute: '00', period: 'AM' };
  }
  const h24 = Math.max(0, Math.min(23, parseInt(match[1], 10) || 0));
  const minute = match[2];
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, minute, period };
}

/**
 * Converts 12-hour picker parts back into canonical "HH:mm" 24-hour string
 * so stored schedule times preserve exact chronological sorting.
 */
export function combine12To24(hour12: number, minute: string, period: 'AM' | 'PM'): string {
  const clampedHour = Math.max(1, Math.min(12, Number(hour12) || 12));
  let h24 = clampedHour % 12;
  if (period === 'PM') h24 += 12;
  const minPadded = String(Math.max(0, Math.min(59, parseInt(minute, 10) || 0))).padStart(2, '0');
  return `${String(h24).padStart(2, '0')}:${minPadded}`;
}

/**
 * Extracts minutes since midnight from a "HH:mm" or "HH:mm - HH:mm" or "3:30 PM" string
 * for accurate chronological sorting.
 */
export function getStartMinutesForSort(timeOrRange?: string | null): number {
  if (!timeOrRange) return 9999;
  const firstPart = timeOrRange.split(/\s*[-–—]\s*/)[0]?.trim() || '';

  const m12 = firstPart.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10) % 12;
    if (m12[3].toUpperCase() === 'PM') h += 12;
    return h * 60 + parseInt(m12[2], 10);
  }

  const m24 = firstPart.match(/^(\d{1,2}):(\d{2})/);
  if (m24) {
    return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
  }

  return 9999;
}
