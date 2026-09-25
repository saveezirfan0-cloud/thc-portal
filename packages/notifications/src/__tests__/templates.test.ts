import { describe, expect, it } from 'vitest';
import {
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
  });

  it('exports SCOPE_CODES, REQUIREMENT_CODES and EXTENSION_CODES as exactly the register, between them', () => {
    expect([...SCOPE_CODES].sort()).toEqual([...PUSH_CODES, ...EMAIL_CODES].sort());
    expect([...REQUIREMENT_CODES].sort()).toEqual(
      [...REQUIREMENT_PUSH_CODES, ...REQUIREMENT_EMAIL_CODES].sort(),
    );
    expect([...SCOPE_CODES, ...REQUIREMENT_CODES, ...EXTENSION_CODES].sort()).toEqual(
      [...Object.keys(TEMPLATES)].sort(),
    );
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

  it('marks mandatory exactly the sends §8 calls mandatory', () => {
    const mandatory = entries.filter(([, v]) => v.mandatory).map(([k]) => k);
    expect(mandatory.sort()).toEqual(
      ['E2', 'E2b', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'N10', 'N10b', 'N10c', 'N12'].sort(),
    );
  });

  it('does not call E3 the only mandatory email while marking others mandatory', () => {
    // §8's opening line says "the only mandatory system email is E3" but its
    // EMAIL table marks E2 and E4–E9 mandatory too; the register follows the
    // table (REGISTER-NOTES.md), so no entry may restate the opening line.
    expect(template('E3').timing).toBe('on acceptance — mandatory (§8 table)');
    for (const [key, value] of entries) {
      expect(
        `${value.trigger} ${value.timing}`.toLowerCase(),
        `${key} restates §8's opening line`,
      ).not.toContain('only mandatory');
    }
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
    // Neither the requirement's codes nor the extensions are §8's.
    const notScope = new Set<string>([...REQUIREMENT_CODES, ...EXTENSION_CODES]);
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
