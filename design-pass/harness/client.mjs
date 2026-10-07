// Client Portal screens for the harness (stress fixtures: long names, many
// roles, every status). Dates are relative to today so the Upcoming tab is
// never empty. Same entry shape as screens.mjs.
import { fileURLToPath } from 'node:url';
import { iso } from './rows.mjs';

const WTDIR = fileURLToPath(new URL('../../', import.meta.url));
const mod = (p) => import(WTDIR + p);

const C = 'apps/client/app/';
const DAY = 24 * 3600e3;
const ymd = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

const WAITING = 'Waiting staff (silver service)';
const ROLES = [
  [WAITING, 12],
  ['Breakdown / Set Up Staff', 4],
  ['Cloakroom attendant', 2],
  ['Bartender', 3],
];
const NAMES = [
  'Amelia Hughes-Montgomery',
  'Tom Baker',
  'Priya Ramanathan',
  'Jack Wilson',
  'Olivia Chen',
  'Mohammed Al-Rashid',
  'Grace O’Connor',
  'Ben Adeyemi',
  'Sophia Papadopoulos-Whitfield',
  'Li Wei',
  'Deleted account #10237',
  'Aisha Khan',
];

const evRows = [
  ['x0', 'Corporate Awards Night', 0, 'ongoing', 'Grosvenor House, Park Lane'],
  [
    'x1',
    'Annual Charity Gala Dinner and Silent Auction — The Savoy Ballroom, Strand',
    1,
    'upcoming',
    'The Savoy Hotel & Conference Centre',
  ],
  ['x2', 'Garden Party', 6, 'upcoming', 'Kensington Palace Orangery'],
  ['x3', 'Summer Garden Party', -9, 'completed', 'Kensington Palace Orangery'],
  ['x4', 'Charity Auction Evening', -20, 'cancelled', 'The Savoy Hotel & Conference Centre'],
].map(([id, title, off, status, venue]) => ({
  id,
  title,
  venue_name: venue,
  venue_address: 'Strand, London WC2R 0EZ',
  event_date: ymd(off),
  po_number: id === 'x1' ? 'PO-2026-00481-SAVOY-LONDON' : null,
  onsite_contact: 'Eleanor Whitfield · +44 20 7836 4343',
  starts_at: iso(ymd(off), '07:30'),
  ends_at: iso(ymd(off), '23:30'),
  status,
}));

const sections = evRows.flatMap((e) =>
  (e.id === 'x2' ? ROLES.slice(0, 1) : ROLES).map(([role, n], i) => ({
    shift_id: e.id + 's' + i,
    event_id: e.id,
    role,
    starts_at: iso(e.event_date, ['07:30', '10:00', '12:00', '17:00'][i]),
    ends_at: iso(e.event_date, ['16:00', '18:00', '20:00', '23:30'][i]),
    headcount: n,
    confirmed: e.id === 'x1' && i === 0 ? n - 3 : n,
  })),
);
const lineup = evRows.flatMap((e) =>
  NAMES.map((n, i) => ({
    booking_id: e.id + 'l' + i,
    event_id: e.id,
    shift_id: e.id + 's' + (i < 8 ? 0 : i < 10 ? 1 : 2),
    role: i < 8 ? WAITING : i < 10 ? ROLES[1][0] : ROLES[2][0],
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    name: i === 10 ? n : n.split(' ')[0] + ' ' + n.split(' ').at(-1)[0] + '.',
    photo_path: null,
    sort_key: n,
    feedback_given: i === 0,
  })),
);
const db = {
  client_events_v: evRows,
  client_role_sections_v: sections,
  client_lineup_v: lineup,
  client_company_v: [{ name: 'Grosvenor House Hotel & Conference Centre' }],
  profiles: [{ full_name: 'Eleanor Whitfield' }],
  client_event_documents_v: [
    {
      id: 'd1',
      event_id: 'x1',
      kind: 'allocation',
      file_name: 'a.pdf',
      storage_path: 'a',
      issued_at: iso(ymd(0)),
    },
    {
      id: 'd2',
      event_id: 'x3',
      kind: 'signout',
      file_name: 'b.pdf',
      storage_path: 'b',
      issued_at: iso(ymd(-8)),
    },
  ],
};
// The fake client ignores .eq(), so an event page gets only its own rows.
const only = (i) => ({
  ...db,
  client_events_v: [evRows[i]],
  client_role_sections_v: sections.filter((r) => r.event_id === evRows[i].id),
  client_lineup_v: lineup.filter((r) => r.event_id === evRows[i].id),
});
const tab = (t) => [
  ['client/EventsScreen.tsx', "useState<Tab>('upcoming')", `useState<Tab>('${t}')`],
];
const L = [C + 'client/layout.tsx'];
const route = (page, pathname, extra = {}) => ({
  app: 'client',
  page: C + page,
  layouts: L,
  pathname,
  db,
  ...extra,
});

const elementOf = (p, props = {}) => ({
  app: 'client',
  pathname: '/',
  db,
  element: async () => (await import('react')).createElement((await mod(C + p)).default, props),
});

export default {
  'cl-login': { app: 'client', page: C + 'login/page.tsx', pathname: '/login', search: {} },
  'cl-forgot': { app: 'client', page: C + 'forgot/page.tsx', pathname: '/forgot' },
  'cl-reset': { app: 'client', page: C + 'reset/page.tsx', pathname: '/reset' },
  'cl-error': elementOf('error.tsx', {
    error: Object.assign(new Error('x'), { digest: '2481903' }),
    reset() {},
  }),
  'cl-notfound': elementOf('not-found.tsx'),
  'cl-account': route('client/account/page.tsx', '/client/account'),
  'cl-list-upcoming': route('client/page.tsx', '/client'),
  'cl-list-all': route('client/page.tsx', '/client', { patch: tab('all') }),
  'cl-list-past': route('client/page.tsx', '/client', { patch: tab('past') }),
  'cl-list-none': route('client/page.tsx', '/client', {
    db: { ...db, client_events_v: [], client_role_sections_v: [], client_lineup_v: [] },
  }),
  'cl-event-upcoming': route('client/events/[id]/page.tsx', '/client/events/x1', {
    params: { id: 'x1' },
    db: only(1),
  }),
  'cl-event-live': route('client/events/[id]/page.tsx', '/client/events/x0', {
    params: { id: 'x0' },
    db: only(0),
  }),
  'cl-event-cancelled': route('client/events/[id]/page.tsx', '/client/events/x4', {
    params: { id: 'x4' },
    db: only(4),
  }),
};
