// Fixtures and screens for the profile-tables pass: the Availability and
// History tabs, /users, /activity, /inbox and /account. Merged into the
// registry by screens.mjs.
import { dirname, join } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const O = WT + '/apps/office/app/';
const iso = (d, hm = '12:00') => new Date(`${d}T${hm}:00+01:00`).toISOString();

export const availabilityRows = [
  {
    id: 'u1',
    starts_at: iso('2026-10-03', '00:00'),
    ends_at: iso('2026-10-04', '00:00'),
    all_day: true,
    series_id: null,
    series_count: 1,
    series_last_start: null,
    created_at: iso('2026-09-20', '10:12'),
    bookings: [
      {
        bookingId: 'b1',
        eventId: 'e1',
        eventTitle: 'Autumn Gala Dinner — The Savoy Ballroom',
        roleName: 'Waiting staff (silver service)',
        startsAt: iso('2026-10-03', '17:00'),
        endsAt: iso('2026-10-03', '23:30'),
      },
    ],
  },
  {
    id: 'u2',
    starts_at: iso('2026-10-08', '09:00'),
    ends_at: iso('2026-10-08', '14:00'),
    all_day: false,
    series_id: 's1',
    series_count: 6,
    series_last_start: iso('2026-11-12', '09:00'),
    created_at: iso('2026-09-21', '18:40'),
    bookings: [],
  },
];

export const historyRows = [
  {
    id: 912,
    at: iso('2026-09-24', '11:02'),
    actor: 'a1',
    actor_name: 'Sarah Mitchell',
    action: 'block_manual',
    entity: 'staff',
    entity_id: 's1',
    entity_label: 'Amelia Hughes-Montgomery',
    data: { reason: 'Repeated no-shows at Grosvenor House; spoke to her on 23.09.2026' },
  },
  {
    id: 911,
    at: iso('2026-09-23', '17:21'),
    actor: null,
    actor_name: null,
    action: 'booking.manual_invite',
    entity: 'booking',
    entity_id: 'b3',
    entity_label: 'Autumn Gala Dinner — The Savoy Ballroom · Bartender',
    data: { from: 'invited', to: 'confirmed' },
  },
  {
    id: 910,
    at: iso('2026-09-22', '09:14'),
    actor: 'a2',
    actor_name: 'Jonathan Fairweather-Clarke',
    action: 'account.disabled',
    entity: 'compliance_docs',
    entity_id: 'd1',
    entity_label: 'Passport',
    data: { expiryDate: '2031-03-14', documentNumber: '548213907' },
  },
];

const accounts = [
  ['Sarah Mitchell', 'sarah.mitchell@thehospitalitycompany.co.uk', 'admin', 'owner'],
  [
    'Jonathan Fairweather-Clarke',
    'jonathan.fairweather-clarke@thehospitalitycompany.co.uk',
    'admin',
    'manager',
  ],
  ['Eleanor Whitfield', 'eleanor.whitfield@grosvenorhouse-events.co.uk', 'client', null],
  ['Priya Ramanathan', 'priya.r@example.com', 'staff', null],
].map(([full_name, email, role, office_role], i) => ({
  id: 'acc' + i,
  email,
  role,
  office_role,
  full_name,
  phone: i === 1 ? '+44 7700 900123' : null,
  job_title: i === 1 ? 'Operations manager' : null,
  client_id: role === 'client' ? 'c1' : null,
  client_name: role === 'client' ? 'Grosvenor House Hotel & Conference Centre' : null,
  staff_id: role === 'staff' ? 's2' : null,
  created_at: iso('2026-06-0' + (i + 1)),
  last_sign_in_at: i === 2 ? null : iso('2026-09-2' + i, '08:4' + i),
  disabled: i === 3,
}));

const inboxRows = [
  {
    id: 71,
    key: 'E8:staff:dddddddd-0000-4000-8000-000000000001:1759999999',
    template: 'E8',
    recipient_emails: ['admin@thehospitalitycompany.co.uk'],
    payload: { name: 'Amelia Hughes-Montgomery', employeeId: '10231', reason: 'Moving away' },
    queued_at: iso('2026-09-24', '14:30'),
    send_after: iso('2026-09-24', '14:30'),
    sent_at: iso('2026-09-24', '14:31'),
    failed_at: null,
    error: null,
    attempts: 1,
  },
  {
    id: 70,
    key: 'E10:booking:0a0a0a0a-0000-4000-8000-000000000001',
    template: 'E10',
    recipient_emails: ['admin@thehospitalitycompany.co.uk', 'ops@thehospitalitycompany.co.uk'],
    payload: {
      name: 'Priya Ramanathan',
      employeeId: '10202',
      event: 'Autumn Gala Dinner',
      role: 'Bartender',
      date: 'Sat 03 Oct 2026',
    },
    queued_at: iso('2026-09-24', '09:02'),
    send_after: iso('2026-09-24', '09:02'),
    sent_at: null,
    failed_at: iso('2026-09-24', '10:02'),
    error: 'Resend answered 422: the recipient mailbox is unavailable',
    attempts: 3,
  },
  {
    id: 69,
    key: 'BG08:2026-09-28',
    template: 'BG08',
    recipient_emails: ['payroll@thehospitalitycompany.co.uk'],
    payload: { periodStart: '21 Sep 2026', periodEnd: '27 Sep 2026' },
    queued_at: iso('2026-09-22', '07:00'),
    send_after: iso('2026-09-22', '07:00'),
    sent_at: null,
    failed_at: null,
    error: null,
    attempts: 0,
  },
];

const office = (file, name, props) => ({
  app: 'office',
  pathname: '/' + file.split('/')[0],
  element: async () => (await import('react')).createElement((await import(O + file))[name], props),
});

export default (profileTab) => ({
  // §1.8 with a reader outside the UK: the scheduled window's "your time" line.
  'staff-profile-shifts-ny': (() => {
    const s = profileTab('shifts');
    return {
      ...s,
      patch: [
        ...s.patch,
        [
          'components/ScheduledWindow.tsx',
          'const zone = override ?? browser;',
          "const zone = override ?? 'America/New_York';",
        ],
      ],
    };
  })(),
  'staff-profile-availability': (() => {
    const s = profileTab('availability');
    return {
      ...s,
      db: { ...s.db, 'rpc:office_staff_unavailability': availabilityRows },
    };
  })(),
  'staff-profile-history': (() => {
    const s = profileTab('history');
    globalThis.__historyRows = historyRows;
    return {
      ...s,
      setup: () => {
        globalThis.__historyRows = historyRows;
      },
      patch: [
        ...s.patch,
        [
          '_components/history/RecordHistory.tsx',
          'useState<HistoryRow[] | null>(null)',
          'useState<HistoryRow[] | null>(globalThis.__historyRows ?? null)',
        ],
        [
          '_components/history/RecordHistory.tsx',
          'useState<number | null>(null)',
          'useState<number | null>(910)',
        ],
      ],
    };
  })(),
  users: office('users/UsersScreen.tsx', 'UsersScreen', {
    data: {
      accounts,
      clients: [{ id: 'c1', name: 'Grosvenor House Hotel & Conference Centre' }],
      selfId: 'acc0',
      problem: null,
    },
  }),
  activity: office('activity/ActivityScreen.tsx', 'ActivityScreen', {
    data: {
      rows: historyRows,
      entities: [
        { entity: 'staff', n: 12 },
        { entity: 'booking', n: 40 },
      ],
      actors: [{ id: 'a1', name: 'Sarah Mitchell', n: 20 }],
      nextBefore: 910,
      problem: null,
    },
    filters: { entity: null, actor: null, query: null, period: '30d', before: null },
  }),
  inbox: office('inbox/InboxScreen.tsx', 'InboxScreen', {
    data: { rows: inboxRows, failedInPeriod: 1, nextBefore: 69, problem: null },
    filters: { type: null, status: null, period: '30d', before: null },
  }),
  account: office('account/AccountScreen.tsx', 'AccountScreen', {
    data: {
      account: {
        email: 'jonathan.fairweather-clarke@thehospitalitycompany.co.uk',
        pendingEmail: 'jon.fc@thehospitalitycompany.co.uk',
        fullName: 'Jonathan Fairweather-Clarke',
        phone: '+44 7700 900123',
        jobTitle: 'Operations manager',
        role: 'admin',
        createdAt: iso('2026-06-02'),
        lastSignInAt: iso('2026-09-24', '08:41'),
        twoStep: { on: true, deviceName: 'Jon’s iPhone', since: iso('2026-07-01', '10:00') },
      },
      problem: null,
    },
  }),
});
