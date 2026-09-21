import { describe, expect, it } from 'vitest';
import { SCOPE_CODES, TEMPLATES, body, outboxKey, render, template } from '../templates';
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

const entries = Object.entries(TEMPLATES) as [TemplateCode, Template][];

describe('notification register (§8)', () => {
  it('has an entry for every code in §8', () => {
    for (const code of [...PUSH_CODES, ...EMAIL_CODES]) {
      expect(Object.keys(TEMPLATES), `§8 names ${code}`).toContain(code);
    }
  });

  it('invents no code the scope does not name', () => {
    expect([...Object.keys(TEMPLATES)].sort()).toEqual([...PUSH_CODES, ...EMAIL_CODES].sort());
  });

  it('puts every code on the channel §8 gives it', () => {
    for (const code of PUSH_CODES) expect(TEMPLATES[code as TemplateCode].channel).toBe('push');
    for (const code of EMAIL_CODES) expect(TEMPLATES[code as TemplateCode].channel).toBe('email');
  });

  it('exports SCOPE_CODES as exactly the register', () => {
    expect([...SCOPE_CODES].sort()).toEqual([...Object.keys(TEMPLATES)].sort());
  });

  it('keys every template by its register code', () => {
    for (const [key, value] of entries) expect(value.code).toBe(key);
  });

  it('records the trigger and the timing next to every entry', () => {
    for (const [key, value] of entries) {
      expect(value.trigger, `${key} trigger`).toBeTruthy();
      expect(value.timing, `${key} timing`).toBeTruthy();
      expect(value.title, `${key} title`).toBeTruthy();
      expect(value.body, `${key} body`).toBeTruthy();
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
      ['E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'N10', 'N10b', 'N10c', 'N12'].sort(),
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
    expect(render(template('N8').body, { reason: 'Expired' })).toBe(
      'Document rejected — Expired. Re-upload.',
    );
    expect(render('Hi {who}', {})).toBe('Hi {who}');
  });

  it('substitutes every placeholder N5 names (§8)', () => {
    expect(
      render(template('N5').body, {
        role: 'Bar Staff',
        event: 'Product Launch — Bar',
        dateTime: 'Fri 19 Sep 18:00–01:00',
        rate: '£15.50',
      }),
    ).toBe('Bar Staff · Product Launch — Bar · Fri 19 Sep 18:00–01:00 · £15.50/h');
  });
});
