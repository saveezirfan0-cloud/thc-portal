/**
 * /activity — turning an `audit_log` row into something a person reads
 * (ADR-0055). Pure, and tested.
 */
import { type TimeFormat, clockLabel } from '@thc/domain';

export interface ActivityRow {
  id: number;
  at: string;
  actor: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  data: Record<string, unknown> | null;
}

export type Period = '24h' | '7d' | '30d' | 'all';

export const PERIODS: readonly { value: Period; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

export function parsePeriod(value: unknown): Period {
  return value === '24h' || value === '7d' || value === '30d' || value === 'all' ? value : '30d';
}

/** The earliest instant a period covers, or null for all time. */
export function periodStart(period: Period, now: Date): string | null {
  const hours = period === '24h' ? 24 : period === '7d' ? 24 * 7 : period === '30d' ? 24 * 30 : 0;
  return hours ? new Date(now.getTime() - hours * 3_600_000).toISOString() : null;
}

/** Keys that are already on the row elsewhere, or mean nothing to a reader. */
const HIDDEN = new Set([
  'key',
  'from',
  'to',
  'label',
  'staffId',
  'userId',
  'clientId',
  'bookingId',
  'eventId',
  // Release audit D-M1's rows carry these so History can find them.
  'roleId',
  'feedbackId',
  'sectionId',
]);

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Money in the log's data (release audit D-M1), written as the office writes it. */
const MONEY = new Set(['chargeRate', 'payRate']);

/**
 * A value as words. Nothing is cut short here (release audit 14.10.2026):
 * a long detail is folded on screen by `<ActivityDetails>`, and the CSV
 * export carries it whole. An object is its own "Key: value" pairs, never
 * raw JSON.
 */
function short(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key && MONEY.has(key) && (typeof value === 'number' || typeof value === 'string')) {
    const amount = Number(value);
    return Number.isFinite(amount) ? `£${amount.toFixed(2)}` : String(value);
  }
  // An instant in the data ("uploadedAt") is an audit stamp too: UK, §1.8.
  if (typeof value === 'string') return ISO_INSTANT.test(value) ? auditStamp(value) : value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length ? value.map((v) => short(v)).join(', ') : '—';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${words(k)}: ${short(v, k)}`)
      .join(', ');
  }
  return String(value);
}

/** Past this many characters the Details cell folds, with a "more" to open it. */
export const DETAILS_FOLD = 160;

/**
 * An audit stamp as §1.8 writes one: UK time, dd.mm.yyyy HH:mm — the
 * clock in the reader's 12- or 24-hour choice (ADR-0085), the zone never
 * the reader's own.
 */
export function auditStamp(iso: string, format?: TimeFormat): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // en-GB writes midnight as 24 in some engines; the clock reads 00.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('day')}.${get('month')}.${get('year')} ${clockLabel(`${hour}:${get('minute')}`, format)}`;
}

/** Keys whose readable form is not their code made readable. */
const KEY_LABEL: Readonly<Record<string, string>> = {
  dob: 'Date of birth',
  rtwCheck: 'gov.uk check',
  optOutSignedUnder18: 'Opt-out signed under 18',
  // Release audit D-M1.
  radius: 'Geofence radius (m)',
  poNumber: 'PO number',
  pin: 'Map pin',
  duplicatedFrom: 'Duplicated from',
  section: 'Role section',
};

/** A `{from, to}` pair nested under a key — "Date of birth: 1995-01-01 → 1994-12-31" (ADR-0070). */
function isChange(value: unknown): value is { from?: unknown; to?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ('from' in value || 'to' in value)
  );
}

/** A `yyyy-mm-dd` as the office writes dates, "05.06.1998" (§9.6); anything else as `short()`. */
function dated(value: unknown, key?: string): string {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : short(value, key);
}

function words(key: string): string {
  const known = KEY_LABEL[key];
  if (known) return known;
  const spaced = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The details line under an entry: a settings change reads "from → to";
 * anything else is its data as "Key: value" pairs. Ids are left out —
 * the row already links to what it is about.
 */
export function describe(row: Pick<ActivityRow, 'data'>): string[] {
  const data = row.data ?? {};
  const out: string[] = [];
  if ('from' in data || 'to' in data) {
    out.push(`${short(data['from'])} → ${short(data['to'])}`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (HIDDEN.has(key) || value === null || value === undefined || value === '') continue;
    if (isChange(value)) {
      out.push(`${words(key)}: ${dated(value.from, key)} → ${dated(value.to, key)}`);
      continue;
    }
    out.push(`${words(key)}: ${short(value, key)}`);
  }
  return out;
}

/** Who did it. A job or a webhook has no actor, and is the system. */
export function actorName(row: Pick<ActivityRow, 'actor' | 'actor_name'>): string {
  if (!row.actor) return 'System';
  return row.actor_name ?? 'Former user';
}

/** The /activity filters, as the URL carries them. */
export interface ActivityFilters {
  entity: string | null;
  actor: string | null;
  query: string | null;
  period: Period;
  before: number | null;
}

/**
 * The filters from a query string — one reader for the page and for
 * /activity/export, so the file holds what the screen showed.
 */
export function parseFilters(get: (key: string) => string | null | undefined): ActivityFilters {
  const before = Number(get('before'));
  return {
    entity: get('entity') || null,
    actor: get('actor') || null,
    query: get('q')?.trim() || null,
    period: parsePeriod(get('period')),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
  };
}

/** /activity/export stops here and says so; past it, narrow the filters. */
export const EXPORT_CAP = 10_000;

/**
 * "Export CSV": the current filters, without the page. `before` is where
 * the screen has paged to, not what it is filtered by, so the file always
 * starts from the newest entry the filters match.
 */
export function exportHref(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.query) params.set('q', filters.query);
  if (filters.period !== '30d') params.set('period', filters.period);
  const search = params.toString();
  return search ? `/activity/export?${search}` : '/activity/export';
}
