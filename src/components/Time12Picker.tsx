import React from 'react';
import { parse24To12Parts, combine12To24 } from '../utils/timeFormat';

interface Time12PickerProps {
  value: string; // Canonical 24-hour "HH:mm"
  onChange: (next24Value: string) => void;
  ariaLabel?: string;
  compact?: boolean;
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

export const Time12Picker: React.FC<Time12PickerProps> = ({
  value,
  onChange,
  ariaLabel = 'Select time',
  compact = false,
}) => {
  const parts = parse24To12Parts(value);
  const minuteStr = String(parts.minute).padStart(2, '0');
  const minuteOptions = MINUTES.includes(minuteStr)
    ? MINUTES
    : [...MINUTES, minuteStr].sort((a, b) => Number(a) - Number(b));

  const selectClass = compact
    ? 'px-1.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 cursor-pointer'
    : 'px-2 py-2 text-xs bg-white border border-slate-200 rounded-lg font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 cursor-pointer';

  return (
    <div className="flex items-center gap-1" role="group" aria-label={ariaLabel}>
      <select
        aria-label={`${ariaLabel} hour`}
        value={parts.hour12}
        onChange={(e) => onChange(combine12To24(Number(e.target.value), parts.minute, parts.period))}
        className={`${selectClass} flex-1 min-w-0`}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-xs font-bold text-slate-400">:</span>
      <select
        aria-label={`${ariaLabel} minute`}
        value={minuteStr}
        onChange={(e) => onChange(combine12To24(parts.hour12, e.target.value, parts.period))}
        className={`${selectClass} flex-1 min-w-0`}
      >
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label={`${ariaLabel} AM or PM`}
        value={parts.period}
        onChange={(e) =>
          onChange(combine12To24(parts.hour12, parts.minute, e.target.value as 'AM' | 'PM'))
        }
        className={`${selectClass} shrink-0 font-bold`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
};
