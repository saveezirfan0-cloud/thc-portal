// Staff App screens for the harness. Same shape as screens.mjs entries; the
// staff-app audit adds its screens here (app: 'staff', page: 'apps/staff/app/…').
// Data comes through the real loaders: the fake client answers `rpc:<name>`.
const S = 'apps/staff/app/';
const H = 3600e3;
const D = 24 * H;
const at = (ms) => new Date(ms).toISOString();
const now = Date.now();
// A UK-midnight-anchored day offset keeps "Today / Tomorrow" stable.
const dayAt = (days, hour, min = 0) => {
  const d = new Date(now + days * D);
  d.setUTCHours(hour, min, 0, 0);
  return d.getTime();
};

const me = {
  staffId: 'st1',
  firstName: 'Priya',
  lastName: 'Ramanathan',
  employeeId: 10202,
  email: 'priya.ramanathan@example.com',
  phone: '+44 7700 900123',
  homeAddress: '14 Alder Road, London E3 4XY',
  photoPath: null,
  photoLocked: false,
  status: 'compliant',
  blockKind: null,
  leftAt: null,
  rtwBranch: 'student_visa',
  niMasked: 'QQ ** ** 56 C',
  hasNiNumber: true,
  dob: '2001-04-12',
  rating: 4.7,
  reliability: 0.96,
  quizAttempts: 1,
  rejectionCause: null,
  roles: ['Waiting staff', 'Bartender'],
  blockers: [],
  checkedIn: false,
  bank: {
    accountHolder: 'Priya Ramanathan',
    sortCode: '20-45-67',
    accountNumber: '12345678',
    updatedAt: at(now - 30 * D),
  },
};

const booking = (id, status, startsMs, hours, extra = {}) => ({
  booking_id: id,
  status,
  source: 'invite',
  created_at: at(now - 3 * D),
  confirmed_at: status === 'confirmed' || status === 'worked' ? at(now - 2 * D) : null,
  day_before_confirmed_at: null,
  on_day_confirmed_at: null,
  reconfirm_required: false,
  reconfirm_reason: null,
  applied_at: null,
  cancel_cause: null,
  shift_id: 'sh' + id,
  starts_at: at(startsMs),
  ends_at: at(startsMs + hours * H),
  pay_rate: 14,
  dress_code: 'Black tie, black shoes',
  headcount: 12,
  buffer: 1,
  confirmed_count: 9,
  role: 'Waiting staff (silver service)',
  event_id: 'ev' + id,
  event_title: 'Autumn Gala Dinner — The Savoy Ballroom',
  event_date: at(startsMs).slice(0, 10),
  venue_name: "Leonardo Hotel St Paul's, 20 St Martin's Le Grand",
  venue_address: "20 St Martin's Le Grand, London EC1A 4EN, United Kingdom",
  event_cancelled_at: null,
  distance_km: 3.2,
  onsite_contact: status === 'invited' ? null : 'Marta Ilic · 07700 900456',
  notes: null,
  pays_breaks: false,
  no_checkout_open: false,
  hours_limit: false,
  week_start: null,
  booked_hours: null,
  cap_hours: null,
  ...extra,
});

const bookings = [
  booking('b1', 'confirmed', dayAt(0, 17), 6.5, { on_day_confirmed_at: null }),
  booking('b2', 'confirmed', dayAt(1, 8), 8, {
    event_title: 'Waiting Staff at United Grand Lodge',
  }),
  booking('b3', 'confirmed', dayAt(2, 9), 8, {
    reconfirm_required: true,
    reconfirm_reason: 'The office moved the start from 08:00 to 09:00.',
  }),
  booking('b4', 'confirmed', dayAt(9, 15), 5, { event_title: 'Wedding Reception, Claridge’s' }),
  booking('b5', 'invited', dayAt(4, 16), 6, {
    source: 'auto_assign',
    hours_limit: true,
    week_start: '2026-10-05',
    booked_hours: 16,
    cap_hours: 20,
  }),
  booking('b6', 'invited', dayAt(6, 10), 7, { role: 'Bartender' }),
  booking('b7', 'worked', dayAt(-3, 9), 8, {
    event_title: 'Morning Waiting Staff · Tomorrow Capital',
  }),
  booking('b8', 'applied', dayAt(5, 12), 5, { applied_at: at(now - D) }),
];

const openShifts = [
  ['o1', 3, 'Leonardo Hotel St Pauls M&E', 'Bartender', true, false, 1.4],
  [
    'o2',
    5,
    'Conference Day, Excel London, Royal Victoria Dock',
    'Waiting staff',
    false,
    true,
    12.8,
  ],
  ['o3', 7, 'Private Dinner, Mayfair', 'Barista', false, false, 8.1],
].map(([id, d, title, role, qualified, hoursLimit, km]) => ({
  shift_id: id,
  event_id: 'e' + id,
  event_title: title,
  event_date: at(dayAt(d, 9)).slice(0, 10),
  role,
  starts_at: at(dayAt(d, 9)),
  ends_at: at(dayAt(d, 17)),
  pay_rate: 14,
  dress_code: 'All black',
  venue_name: 'Freemasons’ Hall (United Grand Lodge of England)',
  venue_address: '60 Great Queen St, London WC2B 5AZ',
  distance_km: km,
  headcount: 12,
  buffer: 1,
  confirmed_count: 7,
  qualified,
  hours_limit: hoursLimit,
  applied_at: null,
  week_start: '2026-10-05',
  booked_hours: hoursLimit ? 18 : 6,
  cap_hours: 20,
  venue_lat: 51.5155,
  venue_lng: -0.1203,
  geofence_radius_m: 150,
  home_lat: 51.5,
  home_lng: -0.05,
}));

const meter = {
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  bookedHours: 14.5,
  capHours: 20,
  roles: [],
};

const base = {
  'rpc:staff_me': me,
  'rpc:staff_bookings': bookings,
  'rpc:staff_open_shifts': openShifts,
  'rpc:staff_week_meter': meter,
};
const entry = (page, pathname, db = {}, search = {}, extra = {}) => ({
  app: 'staff',
  page: S + page,
  pathname,
  search,
  layouts: [],
  db: { ...base, ...db },
  // The root layout is not rendered, so pull in the sheet it imports.
  setup: async () => {
    await import('../../apps/staff/app/tap.css');
  },
  ...extra,
});

const earnings = [
  ['eb1', -3, 8, 'Autumn Gala Dinner — The Savoy Ballroom', 'Waiting staff (silver service)'],
  ['eb2', -10, 5, 'Wedding Reception, Claridge’s', 'Bartender'],
  ['eb3', -17, 7, 'Conference Day, Excel London, Royal Victoria Dock', 'Waiting staff'],
].map(([id, d, h, title, role]) => ({
  booking_id: id,
  event_title: title,
  venue_name: 'Leonardo Hotel St Paul’s',
  venue_address: '20 St Martin’s Le Grand, London EC1A 4EN',
  role_name: role,
  starts_at: at(dayAt(d, 9)),
  ends_at: at(dayAt(d, 9 + h)),
  pay_rate: 14,
  check_in_at: at(dayAt(d, 9)),
  check_out_at: at(dayAt(d, 9 + h)),
  unpaid_break_min: 30,
  left_early: false,
  no_check_out: 'none',
  pay_date: at(dayAt(d + 14, 12)).slice(0, 10),
}));

const docs = {
  staffId: 'st1',
  today: new Date().toISOString().slice(0, 10),
  status: 'compliant',
  blockKind: null,
  rtwBranch: 'student_visa',
  dob: '2001-04-12',
  rightToWorkUntil: '2027-01-31',
  graduatedAt: null,
  courseCompletionDate: null,
  termLetterApplies: true,
  missing: [],
  documents: [
    ['d1', 'passport', 'Passport', 'verified', '2031-03-14'],
    ['d2', 'share_code_report', 'Share code report', 'pending', '2027-01-31'],
    ['d3', 'term_dates_letter', 'University term dates letter', 'rejected', null],
    ['d4', 'dbs', 'DBS certificate', 'verified', '2026-11-02'],
  ].map(([id, docType, label, reviewStatus, expiresOn]) => ({
    id,
    docType,
    label,
    reviewStatus,
    uploadedAt: at(now - 20 * D),
    reviewedAt: reviewStatus === 'pending' ? null : at(now - 18 * D),
    expiresOn,
    rejectionReason: reviewStatus === 'rejected' ? 'The letter is unsigned.' : null,
    evidenceForm: null,
    completionDateClaimed: null,
    completionDate: null,
    shareCodeTail: docType === 'share_code_report' ? '2LM' : null,
    hasFile: true,
    isCurrent: true,
    isCountedVerified: reviewStatus === 'verified',
  })),
  declarations: [],
  cap: { hours: 20, band: 'term', label: '20 h in term time', until: '2026-12-13' },
  optOut: {
    signed: false,
    signedAt: null,
    noticeDays: null,
    cancelledFrom: null,
    hasSignedCopy: false,
  },
};

const detail = (b, extra = {}) => ({
  booking_id: b.booking_id,
  status: b.status,
  confirmed_at: b.confirmed_at,
  event_title: b.event_title,
  event_date: b.event_date,
  venue_name: b.venue_name,
  venue_address: b.venue_address,
  onsite_contact: b.onsite_contact,
  notes: 'Staff entrance on Bull Inn Court. Ask for Marta at the loading bay.',
  dress_code: b.dress_code,
  role: b.role,
  starts_at: b.starts_at,
  ends_at: b.ends_at,
  pay_rate: 14,
  venue_lat: 51.5155,
  venue_lng: -0.1203,
  geofence_radius_m: 150,
  pays_breaks: false,
  check_in_at: null,
  check_out_at: null,
  breaks: [],
  event_cancelled_at: null,
  cancel_cause: null,
  no_checkout_open: false,
  left_early: false,
  turned_away_at: null,
  turned_away_pay_min: null,
  ...extra,
});
const live = bookings[0];
const detailDb = (row) => ({ 'rpc:staff_shift_detail': row, 'rpc:staff_booking_offers': [] });

// onboarding_state() for the wizard stopped at step n.
const KEYS = [
  'rtwAt',
  'addressAt',
  'selfieAt',
  'documentsAt',
  'inductionAt',
  null,
  'hmrcAt',
  'referencesAt',
  'bankAt',
  'contractAt',
  'tutorialAt',
];
const onboardingAt = (n, extra = {}) => {
  const progress = { ukDocChoice: null, visaType: 'Student' };
  KEYS.forEach((k, i) => {
    if (k && i + 1 < n) progress[k] = at(now - (20 - i) * H);
  });
  const status = n <= 4 ? 'documents' : n <= 6 ? 'quiz' : n <= 9 ? 'additional_info' : 'contract';
  return {
    staffId: 'st1',
    firstName: 'Priya',
    lastName: 'Ramanathan',
    status,
    employeeId: 10202,
    dob: '2001-04-12',
    rtwBranch: 'international_student',
    shareCode: 'W4K9PX2LM',
    wtrOptOut: false,
    homeAddress: '14 Alder Road, Bethnal Green, London E3 4XY',
    homeLat: 51.5,
    homeLng: -0.05,
    photoPath: n > 3 ? 'p/x.jpg' : null,
    niMasked: null,
    quizAttempts: n > 6 ? 1 : 0,
    contractSignedAt: n > 10 ? at(now - H) : null,
    contractVersion: 'thc-agency-worker-2026-09',
    contractStamp: null,
    progress,
    documents: [],
    declaration: null,
    quiz: n > 6 ? [{ attemptNo: 1, percent: 90, passed: true, correct: 9, total: 10 }] : [],
    hmrc: null,
    references: [],
    bank: null,
    contract: {
      version: 'thc-agency-worker-2026-09',
      title: 'Agency worker agreement',
      body: 'Clause 1. The worker agrees to the terms.\n\nClause 2. Pay is the base rate.',
      isPlaceholder: true,
    },
    ...extra,
  };
};
const quizQs = Array.from({ length: 10 }, (_, i) => ({
  id: 'q' + i,
  question_no: i + 1,
  prompt: 'What should you do first if you spot a spill on the dining-room floor during service?',
  options: [
    'Walk around it',
    'Cordon it off and tell a supervisor',
    'Ignore it',
    'Cover it with a napkin',
  ],
  image_path: null,
}));
const wiz = (n) =>
  entry(
    'onboarding/[step]/page.tsx',
    '/onboarding/' + n,
    {
      'rpc:onboarding_state': onboardingAt(n),
      'rpc:onboarding_quiz_questions': quizQs,
    },
    {},
    { params: { step: String(n) } },
  );
const wizards = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => ['staff-wiz-' + (i + 1), wiz(i + 1)]),
);

const locked = (extra) => ({ 'rpc:staff_me': { ...me, ...extra } });
const empty = {
  'rpc:staff_bookings': [],
  'rpc:staff_open_shifts': [],
  'rpc:staff_week_meter': null,
};

export default {
  ...wizards,
  'staff-lock-docs': entry(
    'shifts/page.tsx',
    '/shifts',
    locked({
      status: 'blocked',
      blockKind: 'auto_document',
      blockers: ['document_expired:passport'],
    }),
  ),
  'staff-lock-hold': entry(
    'shifts/page.tsx',
    '/shifts',
    locked({ status: 'blocked', blockKind: 'manual' }),
  ),
  'staff-lock-quiz': entry(
    'profile/page.tsx',
    '/profile',
    locked({ status: 'rejected', rejectionCause: 'quiz_failed', quizAttempts: 3 }),
  ),
  'staff-lock-leaver': entry(
    'shifts/page.tsx',
    '/shifts',
    locked({ status: 'inactive', leftAt: at(now - 5 * D) }),
  ),
  'staff-lock-onboarding': entry('shifts/page.tsx', '/shifts', locked({ status: 'documents' })),
  'staff-shifts-empty': entry('shifts/page.tsx', '/shifts', empty),
  'staff-shifts-open-empty': entry('shifts/page.tsx', '/shifts', empty, { tab: 'open' }),
  'staff-invites-empty': entry('invites/page.tsx', '/invites', empty),
  'staff-radar-empty': entry('radar/page.tsx', '/radar', empty),
  'staff-shifts': entry('shifts/page.tsx', '/shifts'),
  'staff-shifts-open': entry('shifts/page.tsx', '/shifts', {}, { tab: 'open' }),
  'staff-invites': entry('invites/page.tsx', '/invites'),
  'staff-radar': entry('radar/page.tsx', '/radar'),
  'staff-profile': entry('profile/page.tsx', '/profile', {
    'rpc:staff_earnings': earnings,
    'rpc:staff_documents': docs,
    'rpc:my_emergency_contact': null,
  }),
  'staff-profile-details': entry('profile/details/page.tsx', '/profile/details', {
    'rpc:my_emergency_contact': null,
    'rpc:my_profile_change_requests': [],
  }),
  'staff-profile-security': entry('profile/security/page.tsx', '/profile/security'),
  'staff-profile-payments': entry('profile/payments/page.tsx', '/profile/payments', {
    'rpc:staff_earnings': earnings,
  }),
  'staff-profile-bank': entry(
    'profile/payments/page.tsx',
    '/profile/payments',
    {},
    { tab: 'bank' },
  ),
  'staff-profile-prefs': entry('profile/preferences/page.tsx', '/profile/preferences', {
    'rpc:my_time_format': '24h',
  }),
  'staff-profile-avail': entry('profile/availability/page.tsx', '/profile/availability', {
    'rpc:my_unavailability': [],
  }),
  'staff-profile-refer': entry('profile/refer/page.tsx', '/profile/refer', {
    'rpc:my_referral_code': 'PRIYAK7Q',
    'rpc:my_referral_summary': { applied: 3 },
  }),
  'staff-documents': entry('documents/page.tsx', '/documents', {
    'rpc:staff_documents': docs,
  }),
  'staff-shift-today': entry(
    'shifts/[id]/page.tsx',
    '/shifts/b1',
    detailDb(detail(live)),
    {},
    { params: { id: 'b1' } },
  ),
  // A long event and role name: the header title must stop at two lines.
  'staff-shift-long-title': entry(
    'shifts/[id]/page.tsx',
    '/shifts/b1',
    detailDb(
      detail({
        ...live,
        event_title: 'Autumn Gala Dinner and Charity Auction in aid of the Royal Marsden Hospital',
        role: 'Senior Waiting Staff, Silver Service, Head Table Captain',
      }),
    ),
    {},
    { params: { id: 'b1' } },
  ),
  'staff-shift-live': entry(
    'shifts/[id]/page.tsx',
    '/shifts/b1',
    detailDb(
      detail(
        { ...live, starts_at: at(now - 2 * H), ends_at: at(now + 4 * H) },
        {
          starts_at: at(now - 2 * H),
          ends_at: at(now + 4 * H),
          check_in_at: at(now - 2 * H + 5 * 60e3),
          breaks: [{ id: 'br1', startedAt: at(now - H), endedAt: at(now - H + 20 * 60e3) }],
        },
      ),
    ),
    {},
    { params: { id: 'b1' } },
  ),
  'staff-shift-tomorrow': entry(
    'shifts/[id]/page.tsx',
    '/shifts/b2',
    detailDb(detail(bookings[1])),
    {},
    { params: { id: 'b2' } },
  ),
  'staff-invite-detail': entry(
    'invites/[id]/page.tsx',
    '/invites/b6',
    detailDb(detail(bookings[5])),
    {},
    { params: { id: 'b6' } },
  ),
  'staff-radar-detail': entry('radar/[id]/page.tsx', '/radar/o1', {}, {}, { params: { id: 'o1' } }),
  'staff-doc-optout': entry('documents/opt-out/page.tsx', '/documents/opt-out', {
    'rpc:staff_documents': docs,
  }),
  'staff-doc-declare': entry('documents/declare/page.tsx', '/documents/declare', {
    'rpc:staff_documents': docs,
  }),
  'staff-doc-letter': entry(
    'documents/completion-letter/page.tsx',
    '/documents/completion-letter',
    { 'rpc:staff_documents': docs },
  ),
  'staff-doc-upload': entry(
    'documents/upload/[docType]/page.tsx',
    '/documents/upload/passport',
    { 'rpc:staff_documents': docs },
    {},
    { params: { docType: 'passport' } },
  ),
  'staff-doc-upload-share': entry(
    'documents/upload/[docType]/page.tsx',
    '/documents/upload/share_code_report',
    { 'rpc:staff_documents': docs },
    {},
    { params: { docType: 'share_code_report' } },
  ),
  'staff-change-name': entry(
    'profile/details/request/page.tsx',
    '/profile/details/request',
    { 'rpc:my_profile_change_requests': [] },
    { kind: 'name' },
  ),
  'staff-apply': entry('apply/page.tsx', '/apply'),
  'staff-privacy': entry('privacy/page.tsx', '/privacy'),
  'staff-login': entry('login/page.tsx', '/login'),
  'staff-forgot': entry('forgot/page.tsx', '/forgot'),
  'staff-install': entry('install/page.tsx', '/install'),
  'staff-notifications': entry('notifications/page.tsx', '/notifications'),
  'staff-offline': entry('offline/page.tsx', '/offline'),
};
