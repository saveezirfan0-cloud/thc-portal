/** Small, pure readers for the odd values timesheets contain. */

/**
 * "25:14" -> 25.23 (hours, 2 dp). Accepts "h:mm", "h:mm:ss", a plain
 * decimal ("7.5", 7.5), and "7h 30m". Null when it is not a duration.
 */
export function hhmmToHours(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  let m = /^(\d{1,4}):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text);
  if (m) {
    return round2(Number(m[1]) + Number(m[2]) / 60 + Number(m[3] ?? 0) / 3600);
  }
  m = /^(\d{1,4})\s*h(?:rs?|ours?)?\s*(?:([0-5]?\d)\s*m(?:in(?:ute)?s?)?)?$/.exec(text);
  if (m) return round2(Number(m[1]) + Number(m[2] ?? 0) / 60);
  if (/^\d+(\.\d+)?$/.test(text)) return round2(Number(text));
  return null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

function isoOrNull(y: number, mo: number, d: number): string | null {
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A date as a UK sheet writes it (day first): 12/10/26, 12.10.2026,
 * 12-10-26, "12th Oct 2026", ISO, a Date, or an Excel serial. Null when
 * unreadable. Never month-first.
 */
export function parseUkDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : isoOrNull(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return null;
    return parseUkDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000));
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (m) return isoOrNull(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/i.exec(text);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoOrNull(y, Number(m[2]), Number(m[1]));
  }
  m = /^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([a-z]{3,9})\.?,?[\s\-/]+(\d{2}|\d{4})$/i.exec(text);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    if (!mo) return null;
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoOrNull(y, mo, Number(m[1]));
  }
  return null;
}

/** 'HH:MM' (24h) from "9:30", "09.30", "0930", "5pm", "5:30 pm", a day fraction. */
export function parseClock(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!(value >= 0 && value < 1)) return null;
    const mins = Math.round(value * 1440) % 1440;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2})(?:[:.h]?([0-5]\d))?(?::[0-5]\d)?\s*([ap]\.?m\.?)?$/i.exec(value.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3]?.toLowerCase().replace(/\./g, '');
  if (mer) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer === 'pm' ? 12 : 0);
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Break minutes from 30, "30", "0:30", "30 min", "" (0). Null if unreadable. */
export function parseBreakMin(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text || text === '-' || text === 'none' || text === 'nil') return 0;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,3})(?:\s*(?:m|min|mins|minutes?))?$/.exec(text);
  if (m) return Number(m[1]);
  return null;
}

/** "Ana Costa (1234)" -> { name: "Ana Costa", ref: "1234" }. */
export function splitStaffRef(text: string): { name: string; ref: string | null } {
  const m = /^(.*?)\s*[([]\s*([A-Za-z0-9-]{1,20})\s*[)\]]\s*$/.exec(text.trim());
  if (!m) return { name: text.replace(/\s+/g, ' ').trim(), ref: null };
  return { name: m[1]!.replace(/\s+/g, ' ').trim(), ref: m[2]! };
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/g, ' ').trim();
}

export function normHeader(value: unknown): string {
  return cellText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
