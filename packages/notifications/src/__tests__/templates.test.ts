import { describe, expect, it } from 'vitest';
import {
  ADDITION_CODES,
  EXTENSION_CODES,
  REQUIREMENT_CODES,
  SCOPE_CODES,
  TEMPLATES,
  body,
  outboxKey,
  render,
  template,
} from '../templates';
import type { Template, TemplateCode } from '../templates';

/**
 * The codes §8 names, written out again by hand from the scope tables so the
 * register cannot drift: the PUSH table (N1–N15 with the N6b/N9b/N10b/N10c
 * sub-codes) and the EMAIL table (E1–E9, no E-sub-codes).
 */
const PUSH_CODES = [
  'N1',
  'N2',
  'N3',
  'N4',
  'N5',
  'N6',
  'N6b',
  'N7',
  'N8',
  'N9',
  'N9b',
  'N10',
  'N10b',
  'N10c',
  'N11',
  'N12',
  'N13',
  'N14',
  'N15',
];
const EMAIL_CODES = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'];

/**
 * The University Completion Letter requirement §5 — a later THC document than
 * the scope, so its codes are listed apart: CL1–CL2 to the worker, CL3–CL6 to
 * the office. "Rejected (with reason)" is N8, not a new code.
 */
const REQUIREMENT_PUSH_CODES = ['CL1', 'CL2'];
const REQUIREMENT_EMAIL_CODES = ['CL3', 'CL4', 'CL5', 'CL6'];

/**
 * The Staff App additions (docs/18 §3, §4, §6) — not §8's, not the
 * requirement's. RC = Request a change (ADR-0038), OF = Offer up a shift
 * (ADR-0039). RF1 (ADR-0040) is proposed only and must NOT be here.
 */
const ADDITION_PUSH_CODES = ['RC2', 'RC3', 'OF1', 'OF2', 'OF3', 'OF4', 'OF6'];
const ADDITION_EMAIL_CODES = ['RC1', 'RC4', 'OF5'];

const entries = Object.entries(TEMPLATES) as [TemplateCode, Template][];

describe('notification register (§8)', () => {
  it('has an entry for every code in §8', () => {
    for (const code of [...PUSH_CODES, ...EMAIL_CODES]) {
      expect(Object.keys(TEMPLATES), `§8 names ${code}`).toContain(code);
    }
  });

  it('invents no code the scope or the completion letter requirement does not name, bar the listed extensions', () => {
    expect([...Object.keys(TEMPLATES)].sort()).toEqual(
      [
        ...PUSH_CODES,
        ...EMAIL_CODES,
        ...REQUIREMENT_PUSH_CODES,
        ...REQUIREMENT_EMAIL_CODES,
        ...EXTENSION_CODES,
        ...ADDITION_PUSH_CODES,
        ...ADDITION_EMAIL_CODES,
      ].sort(),
    );
  });

  it('says why every extension exists, on the entry itself', () => {
    for (const code of EXTENSION_CODES) {
      expect(TEMPLATES[code].trigger, `${code} trigger`).toMatch(/Not in §8/);
    }
  });

  it('puts every code on the channel §8 gives it', () => {
    for (const code of PUSH_CODES) expect(TEMPLATES[code as TemplateCode].channel).toBe('push');
    for (const code of EMAIL_CODES) expect(TEMPLATES[code as TemplateCode].channel).toBe('email');
    for (const code of REQUIREMENT_PUSH_CODES)
      expect(TEMPLATES[code as TemplateCode].channel).toBe('push');
    for (const code of REQUIREMENT_EMAIL_CODES)
      expect(TEMPLATES[code as TemplateCode].channel).toBe('email');
    for (const code of ADDITION_PUSH_CODES)
      expect(TEMPLATES[code as TemplateCode].channel, code).toBe('push');
    for (const code of ADDITION_EMAIL_CODES)
      expect(TEMPLATES[code as TemplateCode].channel, code).toBe('email');
  });

  it('exports SCOPE_CODES, REQUIREMENT_CODES, EXTENSION_CODES and ADDITION_CODES as exactly the register, between them', () => {
    expect([...SCOPE_CODES].sort()).toEqual([...PUSH_CODES, ...EMAIL_CODES].sort());
    expect([...REQUIREMENT_CODES].sort()).toEqual(
      [...REQUIREMENT_PUSH_CODES, ...REQUIREMENT_EMAIL_CODES].sort(),
    );
    expect([...ADDITION_CODES]).toEqual([
      'RC1',
      'RC2',
      'RC3',
      'RC4',
      'OF1',
      'OF2',
      'OF3',
      'OF4',
      'OF5',
      'OF6',
    ]);
    const union = [...SCOPE_CODES, ...REQUIREMENT_CODES, ...EXTENSION_CODES, ...ADDITION_CODES];
    // Disjoint: no code is counted in two lists.
    expect(new Set(union).size).toBe(union.length);
    expect(union.sort()).toEqual([...Object.keys(TEMPLATES)].sort());
  });

  it('keys every template by its register code', () => {
    for (const [key, value] of entries) expect(value.code).toBe(key);
  });

  it('records the trigger and the timing next to every entry', () => {
    for (const [key, value] of entries) {
      expect(value.trigger, `${key} trigger`).toBeTruthy();
      expect(value.timing, `${key} timing`).toBeTruthy();
      expect(value.title, `${key} title`).toBeTruthy();
      expect(value.body ?? value.variants, `${key} needs a body or variants`).toBeTruthy();
    }
  });

  it('sends emails from a named sender (§9.12)', () => {
    for (const [key, value] of entries) {
      if (value.channel === 'email') expect(value.sender, `${key} sender`).toBeDefined();
      else expect(value.sender, `${key} is a push, it has no sender`).toBeUndefined();
    }
  });

  it('uses only the two THC addresses, plus Willo for the one email Willo sends', () => {
    for (const [key, value] of entries) {
      if (value.sender === 'willo') expect(key).toBe('E1');
      else if (value.channel === 'email') expect(['admin', 'timesheets']).toContain(value.sender);
    }
  });

  it('gives every push a deep link and no email one', () => {
    for (const [key, value] of entries) {
      if (value.channel === 'push') expect(value.deepLink, `${key} deepLink`).toBeTruthy();
      else expect(value.deepLink, `${key} is an email`).toBeUndefined();
    }
  });

  it('gives N8, and only N8, the Re-upload button §8 names, opening /documents', () => {
    // §2.3 / §2.6 / §8: "Document rejected — [reason]" + a Re-upload button.
    // No other row of the register names a button on the push itself —
    // N6's "I'm ready" and N7's "Confirm today" live on the /shifts card.
    expect(template('N8').action).toBe('Re-upload');
    expect(template('N8').deepLink).toBe('/documents');
    const withButton = entries.filter(([, v]) => v.action).map(([k]) => k);
    expect(withButton).toEqual(['N8']);
  });

  it('marks mandatory exactly the sends §8 calls mandatory', () => {
    const mandatory = entries.filter(([, v]) => v.mandatory).map(([k]) => k);
    expect(mandatory.sort()).toEqual(
      ['E2', 'E2b', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'N10', 'N10b', 'N10c', 'N12'].sort(),
    );
  });

  it('addresses the office/payroll emails as §8 names them', () => {
    expect(TEMPLATES.E5.recipients).toEqual(TEMPLATES.E6.recipients);
    expect(TEMPLATES.E5.recipients).toEqual([
      'gisela@thehospitalitycompany.co.uk',
      'thc_payroll@topsourceworldwide.com',
    ]);
    expect(TEMPLATES.E7.recipients).toEqual([
      'admin@thehospitalitycompany.co.uk',
      'thc_payroll@topsourceworldwide.com',
    ]);
    expect(TEMPLATES.E8.recipients).toEqual(['admin@thehospitalitycompany.co.uk']);
    expect(TEMPLATES.E9.recipients).toEqual(['admin@thehospitalitycompany.co.uk']);
  });

  it('carries the §8 subjects for E8 and E9 verbatim', () => {
    expect(TEMPLATES.E8.title).toBe('P45 requested — {name}, Employee ID {employeeId}');
    expect(TEMPLATES.E9.title).toBe(
      'Criminal conviction declared — {name}, Employee ID {employeeId}',
    );
  });

  it('never leaks the declaration text into E9 (§10.7)', () => {
    expect(TEMPLATES.E9.body).not.toContain('{details}');
    expect(TEMPLATES.E9.body).toContain('not included in this email');
  });
});

describe('N9 — one code, two halves (§8)', () => {
  it('refuses a body without a half', () => {
    expect(() => body('N9')).toThrow(/needs a variant/);
    expect(() => body('N9', 'nope')).toThrow(/no variant/);
  });

  it('returns each half on its own', () => {
    expect(body('N9', 'check-in')).toBe('Time to check in');
    expect(body('N9', 'check-out')).toBe("Don't forget to check out");
  });

  it('returns the single body for every other code', () => {
    expect(body('N12')).toBe('This event has been cancelled');
    expect(() => body('N12', 'check-in')).toThrow(/no variants/);
  });
});

describe('outbox keys', () => {
  it('builds a stable idempotency key', () => {
    expect(outboxKey('N9b', 'booking', 41)).toBe('N9b:booking:41');
  });

  it('keeps N9’s two halves apart', () => {
    expect(outboxKey('N9', 'booking', 41, 'check-in')).not.toBe(
      outboxKey('N9', 'booking', 41, 'check-out'),
    );
  });
});

describe('rendering', () => {
  it('renders placeholders and leaves unknown ones alone', () => {
    expect(render(body('N8'), { reason: 'Expired' })).toBe(
      'Document rejected — Expired. Re-upload.',
    );
    expect(render('Hi {who}', {})).toBe('Hi {who}');
  });

  it('substitutes every placeholder N5 names (§8)', () => {
    expect(
      render(body('N5'), {
        role: 'Bar Staff',
        event: 'Product Launch — Bar',
        dateTime: 'Fri 19 Sep 18:00–01:00',
        rate: '£15.50',
      }),
    ).toBe('Bar Staff · Product Launch — Bar · Fri 19 Sep 18:00–01:00 · £15.50/h');
  });
});

/**
 * §8 copy, verbatim. Written out again from the scope tables (and, for the
 * codes §8 states in prose, from the screen that carries the same wording —
 * see REGISTER-NOTES.md) so that a future edit cannot silently reword a push.
 */
const SCOPE_BODIES: [string, string][] = [
  ['N2', 'Update your {document} — 2 weeks left'],
  ['N3', 'Final reminder: update your {document}'],
  ['N4', 'You have been blocked — please update'],
  ['N5', '{role} · {event} · {dateTime} · {rate}/h'],
  ['N6', "Confirm tomorrow's shift by 12:00 today — or you'll be removed from it"],
  [
    'N6b',
    'You have been removed from your shift tomorrow as we have not received your re-confirmation by the 12:00 deadline',
  ],
  ['N7', "Confirm today's shift"],
  ['N9b', "You haven't checked out of {event} yet — tap to check out."],
  [
    'N10',
    "You're booked! Your application for {event} on {date} has been accepted. Tap to view your shift details.",
  ],
  ['N10b', "You've been removed from {event} · {dateTime}"],
  [
    'N10c',
    'Shift update: the {event} shift on {date} has now been filled. Keep an eye on Radar — new shifts are added regularly.',
  ],
  ['N11', 'Shift time changed — now {window}'],
  ['N12', 'This event has been cancelled'],
  [
    'N13',
    "You've been on shift 6 hours — please ask your manager on site about taking your break.",
  ],
  ['N15', "Thanks for your patience — your shifts are open again. Tap to see what's available."],
  [
    'E2',
    'Thank you for taking the time to complete your interview with The Hospitality Company. On this occasion we will not be taking your application further. We wish you the very best.',
  ],
  [
    'E4',
    "Unfortunately, you haven't passed the Health & Safety assessment after three attempts, which is the maximum number permitted at this stage. As passing this assessment is a required part of onboarding, we're unable to progress your application any further at this time.",
  ],
];

describe('§8 copy is verbatim', () => {
  it.each(SCOPE_BODIES)('%s body matches the scope word for word', (code, expected) => {
    expect(body(code as TemplateCode)).toBe(expected);
  });

  it('covers every code whose copy §8 quotes', () => {
    // The register has 28 entries. The 11 not pinned above are the ones §8
    // states in prose rather than quoting: N1 and N8 (summarised triggers),
    // N9 and N14 (two halves each, pinned in their own suite), and the
    // seven emails whose wording the scope never gives — E1 (Willo's), E3,
    // E5, E6, E7, E8, E9. The CL codes are not §8's at all: the requirement
    // describes each send and quotes none, so they are pinned in their own
    // suite below.
    const pinned = new Set(SCOPE_BODIES.map(([code]) => code));
    // Neither the requirement's codes, the extensions nor the additions are §8's.
    const notScope = new Set<string>([...REQUIREMENT_CODES, ...EXTENSION_CODES, ...ADDITION_CODES]);
    const unpinned = Object.keys(TEMPLATES).filter(
      (code) => !pinned.has(code) && !notScope.has(code),
    );
    expect(unpinned.sort()).toEqual(
      ['N1', 'N8', 'N9', 'N14', 'E1', 'E3', 'E5', 'E6', 'E7', 'E8', 'E9'].sort(),
    );
  });

  it('keeps the §8 timing for the codes with a hard deadline', () => {
    expect(template('N6').timing).toBe('the day before (cutoff 12:00)');
    expect(template('N6b').timing).toBe(
      'at the moment of the automatic 12:05 cutoff (confirmed 01.09.2026)',
    );
    expect(template('N9').timing).toBe('−30 min');
    expect(template('N1').timing).toBe('1 month before');
    expect(template('N2').timing).toBe('2 weeks before');
    expect(template('N3').timing).toBe('1 week before');
  });
});

describe('nothing worker-facing leaks office or client language', () => {
  /**
   * §8's Trigger column is written for the office: "manager presses Withdraw",
   * "unpaid-break clients only". It belongs in `trigger`, never in a title or
   * a body — a worker sees the base rate only and no client commercial detail.
   */
  const OFFICE_LANGUAGE = [
    'unpaid-break',
    'manager presses',
    'auto-assign',
    'first-to-confirm',
    'Booking.source',
    'by the office',
    'headcount',
    'buffer',
    'confirmed 0',
    'mandatory',
    // The Staff App additions' office vocabulary (docs/18 §3, §4): the offer
    // machinery and the change-request queue are the office's words, and a
    // worker push never names another worker's ID, payroll or a rule/ADR.
    'handed_over',
    'self-cancel',
    'self_cancel',
    'allocation',
    'wave 1',
    'wave 2',
    'pool',
    'payroll',
    'employee id',
    'change requests',
    'rule-',
    'adr-',
  ];

  it.each(Object.keys(TEMPLATES))('%s title and body are worker-safe', (code) => {
    const entry: Template = TEMPLATES[code as TemplateCode];
    if (entry.channel !== 'push') return;
    for (const phrase of OFFICE_LANGUAGE) {
      expect(entry.title.toLowerCase(), `${code} title`).not.toContain(phrase.toLowerCase());
      expect((entry.body ?? '').toLowerCase(), `${code} body`).not.toContain(phrase.toLowerCase());
    }
  });

  it('keeps every push title short enough for a lock screen', () => {
    for (const [key, value] of entries) {
      if (value.channel === 'push')
        expect(value.title.length, `${key} title`).toBeLessThanOrEqual(35);
    }
  });

  it('keeps the §8 trigger text verbatim, where that language belongs', () => {
    expect(template('N10b').trigger).toContain('manager presses Withdraw');
    expect(template('N13').trigger).toContain('unpaid-break clients only');
  });
});

describe('a variant-only code has nothing to send by accident', () => {
  it('gives N9 no body at all, so a sender cannot reach the joined line', () => {
    expect((TEMPLATES.N9 as Template).body).toBeUndefined();
    expect(TEMPLATES.N9.scopeCopy).toContain('Time to check in');
  });

  it('gives N14 no body either: one of its two halves asks for a date', () => {
    expect((TEMPLATES.N14 as Template).body).toBeUndefined();
    expect(body('N14', 'dated')).toBe(
      'Your weekly limit is now {limit} hours — {band} until {date}.',
    );
    expect(body('N14', 'open')).toBe('Your weekly limit is now {limit} hours — {band}.');
    expect(body('N14', 'uncapped')).toBe('You no longer have a weekly hours limit — {band}.');
  });

  it('are the only codes without a body, with CL2 for the same reason', () => {
    const bodyless = entries.filter(([, v]) => v.body === undefined).map(([k]) => k);
    expect(bodyless).toEqual(['N9', 'N14', 'CL2']);
  });

  // The bug these halves exist for. `render` leaves an unmatched
  // placeholder in the string, so a single body carrying an optional
  // "until {date}" sends the literal "{date}" to anyone whose band has no
  // end date — a graduate, or a worker who signed the 48-hour opt-out.
  it('never sends an unfilled placeholder to a worker whose band has no end date', () => {
    const sent = render(body('N14', 'open'), {
      limit: '48',
      band: 'your completion letter is verified',
    });
    expect(sent).toBe('Your weekly limit is now 48 hours — your completion letter is verified.');
    expect(sent).not.toContain('{');
  });

  // §8 offers "[20 / 48] hours", which RULE-20's fifth band has no number
  // for. Reusing that sentence sends "now no hours", which reads as zero.
  it('does not tell a worker who lifted their ceiling that they have no hours', () => {
    const sent = render(body('N14', 'uncapped'), {
      band: 'you have signed the 48-hour opt-out',
    });
    expect(sent).toBe(
      'You no longer have a weekly hours limit — you have signed the 48-hour opt-out.',
    );
    expect(sent).not.toContain('{');
    expect(sent).not.toMatch(/\bno hours\b/);
  });

  it('fills every placeholder for a band that does have one', () => {
    const sent = render(body('N14', 'dated'), {
      limit: '20',
      band: 'term time',
      date: '11 Dec 2026',
    });
    expect(sent).toBe('Your weekly limit is now 20 hours — term time until 11 Dec 2026.');
    expect(sent).not.toContain('{');
  });
});

describe('E3 carries everything §8 names', () => {
  it('has activation, password and the download-the-app CTA', () => {
    const copy = body('E3');
    expect(copy).toContain('{link}');
    expect(copy).toContain('password');
    expect(copy.toLowerCase()).toContain('download the app');
  });
});

/**
 * The University Completion Letter requirement §5. Worker: upload received;
 * approved (with new cap and effective date); rejected (with reason). Admin:
 * awaiting review; visa expiry approaching; opt-out signed or cancelled.
 */
describe('completion letter requirement §5', () => {
  it('tells the worker an upload changes nothing yet (acceptance criterion 2)', () => {
    expect(body('CL1')).toContain('stay the same until the office has checked it');
  });

  it('gives the approval a cap and an effective date, in each of its three outcomes', () => {
    expect(render(body('CL2', 'dated'), { limit: '48', date: '12 Oct 2026' })).toBe(
      'Your completion letter is approved — your weekly limit is 48 hours from 12 Oct 2026.',
    );
    const uncapped = render(body('CL2', 'uncapped'), { date: '12 Oct 2026' });
    expect(uncapped).not.toContain('{');
    expect(uncapped).not.toMatch(/\bnull\b|\bno hours\b/);
    // §7: the visa ends first, and the worker is not promised hours.
    const visaFirst = render(body('CL2', 'visa_first'), { date: '10 Oct 2026' });
    expect(visaFirst).toContain('right to work ends on 10 Oct 2026');
    expect(visaFirst).toContain('do not change');
  });

  it('uses N8 for a rejection, with its Re-upload, rather than a code of its own', () => {
    expect(REQUIREMENT_CODES as readonly string[]).not.toContain('N8');
    expect(render(body('N8'), { reason: 'The award date is not visible' })).toBe(
      'Document rejected — The award date is not visible. Re-upload.',
    );
  });

  it('sends the four office emails to admin@ from admin@', () => {
    for (const code of REQUIREMENT_EMAIL_CODES) {
      const entry: Template = TEMPLATES[code as TemplateCode];
      expect(entry.sender, code).toBe('admin');
      expect(entry.recipients, code).toEqual(['admin@thehospitalitycompany.co.uk']);
      expect(entry.mandatory, code).toBeUndefined();
    }
  });

  it('names the alert rungs and what the opt-out does and does not lift', () => {
    expect(template('CL4').timing).toContain('60, 30 and 14 days');
    expect(body('CL5')).toContain('does not lift a Student visa term-time limit');
    expect(body('CL6')).toContain('{effectiveFrom}');
    expect(body('CL6')).toContain('{overCapWeeks}');
  });
});

/**
 * E10 — §9.12: a worker's self-cancel of a confirmed booking "triggers an
 * immediate email to admin@thehospitalitycompany.co.uk, flagging which
 * event/role/shift lost a confirmed worker". §8 gives it no code, so it is
 * an extension, and SCOPE_CODES above still says exactly what §8 says.
 */
describe('E10 — the self-cancel email to the office (§9.12)', () => {
  /**
   * The keys self_cancel_booking() writes (20260927140200). The same list
   * is asserted on the SQL side by supabase/tests/592_self_cancel_office_email.sql,
   * so a key renamed on either side fails one of the two suites.
   */
  const SELF_CANCEL_PAYLOAD_KEYS = [
    'event',
    'client',
    'venue',
    'role',
    'date',
    'dateTime',
    'name',
    'employeeId',
    'cancelledAt',
    'confirmed',
    'headcount',
    'buffer',
    'autoAssign',
  ];

  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

  it('is an extension, not a §8 code', () => {
    expect(EXTENSION_CODES as readonly string[]).toContain('E10');
    expect(SCOPE_CODES as readonly string[]).not.toContain('E10');
    expect(template('E10').trigger).toMatch(/Not in §8/);
    expect(template('E10').trigger).toContain('§9.12');
  });

  it('goes to admin@ from the admin@ sender, and nowhere else', () => {
    const entry = template('E10');
    expect(entry.channel).toBe('email');
    expect(entry.sender).toBe('admin');
    expect(entry.recipients).toEqual(['admin@thehospitalitycompany.co.uk']);
    expect(entry.deepLink).toBeUndefined();
  });

  it('is immediate, as §9.12 says', () => {
    expect(template('E10').timing).toMatch(/^immediately/);
  });

  it('names the event, the role and the shift that lost a confirmed worker', () => {
    const copy = body('E10');
    for (const key of ['event', 'role', 'dateTime', 'venue', 'client']) {
      expect(placeholders(copy), key).toContain(key);
    }
    expect(placeholders(template('E10').title)).toEqual(['event', 'role', 'date']);
  });

  it('asks only for values the database writes', () => {
    const asked = new Set([...placeholders(template('E10').title), ...placeholders(body('E10'))]);
    for (const key of asked) expect(SELF_CANCEL_PAYLOAD_KEYS, key).toContain(key);
  });

  it('renders with no placeholder left, and shows the buffer as "+n", never added in', () => {
    const values = {
      event: 'Gala Dinner',
      client: 'Leonardo Royal',
      venue: 'Leonardo Royal London City',
      role: 'Waiting Staff',
      date: 'Fri 09 Oct 2026',
      dateTime: 'Fri 09 Oct 2026 17:00–23:30',
      name: 'Tom Reid',
      employeeId: '10432',
      cancelledAt: '24 Sep 2026 14:05',
      confirmed: '5',
      headcount: '6',
      buffer: '1',
      autoAssign: 'on',
    };
    const subject = render(template('E10').title, values);
    const sent = render(body('E10'), values);
    expect(subject).toBe(
      'Confirmed worker self-cancelled — Gala Dinner · Waiting Staff · Fri 09 Oct 2026',
    );
    expect(sent).not.toMatch(/[{}]/);
    expect(sent).toContain('Shift: Fri 09 Oct 2026 17:00–23:30 (UK time)');
    expect(sent).toContain('Confirmed for this role now: 5 of 6 (+1)');
  });
});

/**
 * N6 and N7 are queued by booking_tick() (20260927140000) with the payload
 * queue_booking_push() writes for N5/N6b. Their copy needs nothing from it;
 * their deep link needs the booking.
 */
describe('N6 / N7 render from the payload booking_tick writes', () => {
  const payload = {
    bookingId: 'b1',
    shiftId: 's1',
    eventId: 'e1',
    event: 'Gala Dinner',
    window: '18:00–23:00',
  };

  it.each(['N6', 'N7'] as const)('%s leaves no placeholder in title, body or link', (code) => {
    const entry = template(code);
    for (const text of [entry.title, body(code), entry.deepLink ?? '']) {
      expect(render(text, payload), code).not.toMatch(/[{}]/);
    }
    // The "I'm ready" / "Confirm today" buttons live on the /shifts card,
    // so the push opens there, not on the shift detail screen.
    expect(render(entry.deepLink ?? '', payload)).toBe('/shifts');
  });
});

/**
 * The Staff App additions (docs/18-staff-features-plan.md §3, §4, §6). Not
 * §8's: ADR-0038 (RC, Request a change) and ADR-0039 (OF, Offer up a shift),
 * both proposed — awaiting THC. The table below is written out again by hand
 * from docs/18 so an edit to the register cannot silently reword one.
 */
describe('Staff App additions — RC1–RC4, OF1–OF6 (docs/18 §6)', () => {
  const placeholders = (text: string): string[] =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');

  type Row = {
    code: TemplateCode;
    channel: 'push' | 'email';
    title: string;
    body: string;
    deepLink?: string;
    timing: string;
  };

  // docs/18 §3 and §4, the Notifications tables. OF5's body is described
  // there as a list of fields; it is pinned by structure in its own test.
  const PLAN: Row[] = [
    {
      code: 'RC1',
      channel: 'email',
      title: 'Profile change requested — {name}, Employee ID {employeeId}',
      body: '{name} has asked the office to change their {change}.\n\nRequested: {requestedAt} (UK time)\nNow: {current}\nRequested: {proposed}\nNote: {note}\n\nReview it in Staff → Change requests.',
      timing: 'on request',
    },
    {
      code: 'RC2',
      channel: 'push',
      title: 'Profile updated',
      body: 'Your {change} has been updated.',
      deepLink: '/profile/details',
      timing: 'on approve',
    },
    {
      code: 'RC3',
      channel: 'push',
      title: 'Change not made',
      body: "We couldn't update your {change}: {reason}",
      deepLink: '/profile/details',
      timing: 'on reject',
    },
    {
      code: 'RC4',
      channel: 'email',
      title: 'Name changed — {name}, Employee ID {employeeId}',
      body: 'Previous name: {previousName}\nNew name: {name}\nApproved: {approvedAt} (UK time)',
      timing: 'on approving a name',
    },
    {
      code: 'OF1',
      channel: 'push',
      title: 'Shift up for grabs',
      body: '{role} · {event} · {dateTime} · {rate}/h — tap to take it.',
      deepLink: '/radar/offers/{offerId}',
      timing: 'hourly, `allocation_per_hour` per round, wave 1 first, never after expiry',
    },
    {
      code: 'OF2',
      channel: 'push',
      title: 'Shift handed over',
      body: "{event} · {dateTime} has been taken by another worker. You're no longer booked on it.",
      deepLink: '/shifts',
      timing: 'on take',
    },
    {
      code: 'OF3',
      channel: 'push',
      title: "You're still booked",
      body: "Nobody took your {event} shift on {date} — you're still booked. If you can't make it, contact the office.",
      deepLink: '/shifts/{bookingId}',
      timing: 'on lapse by expiry only',
    },
    {
      code: 'OF4',
      channel: 'push',
      title: "You're booked!",
      body: '{event} on {date} is yours. Tap to view your shift details.',
      deepLink: '/shifts/{bookingId}',
      timing: 'on take',
    },
    {
      code: 'OF6',
      channel: 'push',
      title: 'Cover request closed',
      body: "The office has closed your cover request for {event} on {date}. You're still booked — contact the office if you can't make it.",
      deepLink: '/shifts/{bookingId}',
      timing: 'on decline',
    },
  ];

  /**
   * What each sender writes into the payload — the contract pgTAP 674 (OF,
   * "every OF payload's keys equal its template placeholders", the 592
   * pattern) and 665/666 (RC) hold the SQL side to. Title, body and deep
   * link together must ask for exactly these keys, no more and no fewer.
   */
  const PAYLOAD_KEYS: Record<(typeof ADDITION_CODES)[number], string[]> = {
    RC1: ['name', 'employeeId', 'change', 'requestedAt', 'current', 'proposed', 'note'],
    RC2: ['change'],
    RC3: ['change', 'reason'],
    RC4: ['name', 'employeeId', 'previousName', 'approvedAt'],
    OF1: ['role', 'event', 'dateTime', 'rate', 'offerId'],
    OF2: ['event', 'dateTime'],
    OF3: ['event', 'date', 'bookingId'],
    OF4: ['event', 'date', 'bookingId'],
    OF5: [
      'event',
      'role',
      'date',
      'name',
      'employeeId',
      'client',
      'venue',
      'dateTime',
      'note',
      'confirmed',
      'headcount',
      'buffer',
      'autoAssign',
    ],
    OF6: ['event', 'date', 'bookingId'],
  };

  const asked = (code: TemplateCode) => {
    const entry: Template = TEMPLATES[code];
    return new Set([
      ...placeholders(entry.title),
      ...placeholders(entry.body ?? ''),
      ...placeholders(entry.deepLink ?? ''),
    ]);
  };

  it('is exactly the ten codes docs/18 §6 lists, and no RF1', () => {
    expect([...ADDITION_CODES].sort()).toEqual(
      [...ADDITION_PUSH_CODES, ...ADDITION_EMAIL_CODES].sort(),
    );
    expect(Object.keys(TEMPLATES)).not.toContain('RF1');
    for (const code of ADDITION_CODES) {
      expect(SCOPE_CODES as readonly string[], code).not.toContain(code);
      expect(REQUIREMENT_CODES as readonly string[], code).not.toContain(code);
      expect(EXTENSION_CODES as readonly string[], code).not.toContain(code);
    }
  });

  it('names its ADR in every trigger — RC → ADR-0038, OF → ADR-0039', () => {
    for (const code of ADDITION_CODES) {
      const adr = code.startsWith('RC') ? 'ADR-0038' : 'ADR-0039';
      expect(template(code).trigger, code).toContain(adr);
      expect(template(code).trigger, code).toMatch(/Not in §8/);
    }
  });

  it.each(PLAN.map((row) => [row.code, row] as const))(
    '%s carries the docs/18 title, body, deep link and timing verbatim',
    (code, row) => {
      const entry = template(code);
      expect(entry.channel).toBe(row.channel);
      expect(entry.title).toBe(row.title);
      expect(body(code)).toBe(row.body);
      expect(entry.deepLink).toBe(row.deepLink);
      expect(entry.timing).toBe(row.timing);
    },
  );

  it('marks none of them mandatory: §8 does not list them', () => {
    for (const code of ADDITION_CODES) expect(template(code).mandatory, code).toBeUndefined();
  });

  it('sends every addition email from admin@, never timesheets@', () => {
    for (const code of ADDITION_EMAIL_CODES) {
      expect(template(code as TemplateCode).sender, code).toBe('admin');
    }
  });

  it("sends RC4 to exactly E7's recipients", () => {
    expect(TEMPLATES.RC4.recipients).toEqual(TEMPLATES.E7.recipients);
    expect(TEMPLATES.RC4.recipients).toEqual([
      'admin@thehospitalitycompany.co.uk',
      'thc_payroll@topsourceworldwide.com',
    ]);
  });

  it('sends RC1 and OF5 to admin@ only — never payroll', () => {
    expect(TEMPLATES.RC1.recipients).toEqual(['admin@thehospitalitycompany.co.uk']);
    expect(TEMPLATES.OF5.recipients).toEqual(['admin@thehospitalitycompany.co.uk']);
  });

  it('pins OF5 to the fields docs/18 lists, in order, ending "still booked until you act"', () => {
    expect(template('OF5').title).toBe('Cover requested — {event} · {role} · {date}');
    expect(template('OF5').timing).toBe('immediately');
    const copy = body('OF5');
    const order = [
      '{name}',
      '{employeeId}',
      '{event}',
      '{client}',
      '{venue}',
      '{role}',
      '{dateTime} (UK time)',
      '{note}',
      '{confirmed} of {headcount} (+{buffer})',
      '{autoAssign}',
      'They are still booked until you act.',
    ];
    let from = -1;
    for (const part of order) {
      const at = copy.indexOf(part, from + 1);
      expect(at, part).toBeGreaterThan(from);
      from = at;
    }
    expect(copy.endsWith('They are still booked until you act.')).toBe(true);
  });

  it('asks each template for exactly the keys its sender writes', () => {
    for (const code of ADDITION_CODES) {
      expect([...asked(code)].sort(), code).toEqual([...PAYLOAD_KEYS[code]].sort());
    }
  });

  it('uses the names the register already uses for the same thing', () => {
    // A placeholder an addition shares with an older code means the same
    // value there; the new ones are listed so a typo ({bookingID}) fails.
    const existing = new Set<string>();
    for (const [code, entry] of entries) {
      if ((ADDITION_CODES as readonly string[]).includes(code)) continue;
      for (const text of [
        entry.title,
        entry.body ?? '',
        entry.deepLink ?? '',
        ...Object.values(entry.variants ?? {}).map((v) => v.body),
      ]) {
        for (const key of placeholders(text)) existing.add(key);
      }
    }
    const NEW_KEYS = [
      'change',
      'current',
      'proposed',
      'note',
      'previousName',
      'approvedAt',
      'offerId',
    ];
    for (const code of ADDITION_CODES) {
      for (const key of asked(code)) {
        expect(existing.has(key) || NEW_KEYS.includes(key), `${code} {${key}}`).toBe(true);
      }
    }
    // And the new ones are genuinely new, not a rename of an existing key —
    // except {change}, which N11b (ADR-0037, landed on main in parallel)
    // also uses: there it is a sentence ("Dress code changed by the office
    // (was …)"), in RC2/RC3 the word "name" or "photo". Each row carries
    // its own payload, so nothing renders wrongly; the overlap is named
    // here so it is a known one rather than a silent one.
    const SHARED_BY_NAME_ONLY: Record<string, readonly string[]> = { change: ['N11b'] };
    for (const key of NEW_KEYS) {
      const sharedWith = SHARED_BY_NAME_ONLY[key];
      if (sharedWith) {
        const users = entries
          .filter(([code]) => !(ADDITION_CODES as readonly string[]).includes(code))
          .filter(([, entry]) =>
            [entry.title, entry.body ?? '', entry.deepLink ?? ''].some((t) =>
              placeholders(t).includes(key),
            ),
          )
          .map(([code]) => code);
        expect(users.sort(), key).toEqual([...sharedWith].sort());
      } else {
        expect(existing.has(key), key).toBe(false);
      }
    }
  });

  it('renders every addition with no placeholder left', () => {
    const values: Record<string, string> = {
      name: 'Tom Reid',
      employeeId: '10432',
      change: 'name',
      requestedAt: '25 Sep 2026 14:05',
      current: 'Tom Reid',
      proposed: 'Tom Reed',
      note: '—',
      reason: 'The evidence does not show the new name',
      previousName: 'Tom Reid',
      approvedAt: '26 Sep 2026 09:10',
      role: 'Waiting Staff',
      event: 'Gala Dinner',
      date: 'Fri 09 Oct 2026',
      dateTime: 'Fri 09 Oct 2026 17:00–23:30',
      rate: '£13.50',
      offerId: 'o1',
      bookingId: 'b1',
      client: 'Leonardo Royal',
      venue: 'Leonardo Royal London City',
      confirmed: '6',
      headcount: '6',
      buffer: '1',
      autoAssign: 'on',
    };
    for (const code of ADDITION_CODES) {
      const entry = template(code);
      for (const text of [entry.title, body(code), entry.deepLink ?? '']) {
        expect(render(text, values), code).not.toMatch(/[{}]/);
      }
    }
    expect(render(body('OF5'), values)).toContain('Confirmed for this role now: 6 of 6 (+1)');
    expect(render(template('OF1').deepLink ?? '', values)).toBe('/radar/offers/o1');
  });

  it('never tells a candidate who offered the shift (OF1)', () => {
    for (const key of asked('OF1')) {
      expect(['name', 'employeeId', 'firstName', 'offeredBy', 'offerer'], key).not.toContain(key);
    }
  });

  it('never quotes money on a push beyond the base rate', () => {
    for (const code of ADDITION_PUSH_CODES) {
      const text = `${template(code as TemplateCode).title} ${body(code as TemplateCode)}`;
      expect(text, code).not.toMatch(/holiday|12\.07|charge|margin|invoice/i);
    }
  });

  it('keys the sends as docs/18 names them', () => {
    expect(outboxKey('RC1', 'request', 7)).toBe('RC1:request:7');
    expect(outboxKey('RC4', 'request', 7)).toBe('RC4:request:7');
    expect(outboxKey('OF2', 'offer', 'o1')).toBe('OF2:offer:o1');
    // OF1 is once per offer per candidate: the staff id rides as the suffix.
    expect(outboxKey('OF1', 'offer', 'o1', 's9')).toBe('OF1:offer:o1:s9');
    expect(outboxKey('OF1', 'offer', 'o1', 's9')).not.toBe(outboxKey('OF1', 'offer', 'o1', 's8'));
    // OF5 is keyed on the BOOKING (20260930150000): asking for cover, withdrawing
    // and asking again on one booking emails admin@ once.
    expect(outboxKey('OF5', 'booking', 'b1')).toBe('OF5:booking:b1');
  });
});

/**
 * N10d and N11b — §8's trigger applies, §8's copy would be untrue (ADR-0037).
 * N10d is queued by withdraw_booking() (20260930110300) with the same values
 * as N10b; N11b by the office's event save with {change} and {bookingId}.
 */
describe('N10d / N11b — the extensions for a withdrawn invitation and a details change', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

  it('are extensions, never §8 codes', () => {
    for (const code of ['N10d', 'N11b'] as const) {
      expect(EXTENSION_CODES as readonly string[]).toContain(code);
      expect(SCOPE_CODES as readonly string[]).not.toContain(code);
      expect(template(code).trigger).toMatch(/Not in §8/);
      expect(template(code).channel).toBe('push');
    }
  });

  it('N10d reads the values N10b does, and never says the worker was removed', () => {
    expect(placeholders(body('N10d')).sort()).toEqual(placeholders(body('N10b')).sort());
    expect(body('N10d')).not.toMatch(/removed/i);
    expect(render(body('N10d'), { event: 'Gala Dinner', dateTime: 'Sat 19 Sep 17:00' })).toBe(
      'Your invitation to Gala Dinner · Sat 19 Sep 17:00 has been withdrawn.',
    );
    expect(template('N10d').deepLink).toBe('/invites');
  });

  it('N11b does not claim the time changed', () => {
    expect(body('N11b')).not.toMatch(/time/i);
    expect(placeholders(body('N11b'))).toEqual(['change']);
    expect(
      render(body('N11b'), {
        change: 'Dress code changed by the office (was Black & whites)',
      }),
    ).toBe(
      'Shift details changed — Dress code changed by the office (was Black & whites). Please confirm in the app.',
    );
    expect(template('N11b').deepLink).toBe(template('N11').deepLink);
  });
});
