/**
 * /activity — turning an `audit_log` row into something a person reads
 * (ADR-0049). Pure, and tested.
 */

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
]);

function short(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(short).join(', ');
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

function words(key: string): string {
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
    out.push(`${words(key)}: ${short(value)}`);
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
