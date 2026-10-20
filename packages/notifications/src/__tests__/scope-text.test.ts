import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOPE_CODES, TEMPLATES, body } from '../templates';
import type { TemplateCode } from '../templates';

/**
 * The register against the contract itself, `docs/scope/scope-of-work-v1.6.txt`.
 *
 * templates.test.ts pins the §8 copy against a table typed out by hand from
 * the scope. This reads the scope file: every code §8 names has a register
 * entry, and every sendable string §8 quotes is in the scope word for word,
 * once the register's `{placeholders}` are put back as the scope's
 * `[brackets]`. A register edit that drifts from the contract, or a hand
 * table that was typed wrong, fails here.
 */
const SCOPE = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'docs', 'scope', 'scope-of-work-v1.6.txt'),
  'utf8',
);

/** The PDF's text, one line: page markers out, words split at a line end re-joined. */
function flatten(text: string): string {
  return text
    .replace(/=+ PAGE \d+ =+\s*\n\s*\d+\s*\n/g, ' ')
    .replace(/-\s*\n\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[‘’]/g, "'");
}

const start = SCOPE.indexOf('8. NOTIFICATIONS AND EMAILS');
const end = SCOPE.indexOf('PART II · BACK OFFICE PORTAL');
const SECTION_8 = flatten(SCOPE.slice(start, end));
const WHOLE = flatten(SCOPE);

/** The register's placeholders, written back the way §8 writes them. */
const AS_SCOPE: Record<string, string> = {
  '{document}': '[doc]',
  '{dateTime}': '[date/time]',
  '{window}': '[…]',
};
const asScope = (copy: string) =>
  copy.replace(/\{\w+\}/g, (p) => AS_SCOPE[p] ?? `[${p.slice(1, -1)}]`).replace(/[‘’]/g, "'");

describe('the register against docs/scope/scope-of-work-v1.6.txt', () => {
  it('finds §8 in the scope file', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it('has an entry for every code §8 lists, and §8 lists every scope code', () => {
    const named = new Set(SECTION_8.match(/\b(?:N\d{1,2}[a-c]?|E\d)\b/g));
    for (const code of named) expect(Object.keys(TEMPLATES), code).toContain(code);
    for (const code of SCOPE_CODES) expect(named.has(code), code).toBe(true);
  });

  // The pushes §8 quotes in full, in its table. N13's cell is split by the
  // page break (its Timing cell is printed between the halves), so it is
  // checked in halves below.
  it.each([
    'N2',
    'N3',
    'N4',
    'N5',
    'N6',
    'N6b',
    'N7',
    'N9b',
    'N10',
    'N10b',
    'N10c',
    'N11',
    'N12',
    'N15',
  ])('%s is §8 word for word', (code) => {
    expect(SECTION_8).toContain(asScope(body(code as TemplateCode)));
  });

  it('N13 is §8 word for word, either side of the page break', () => {
    const [before, after] = body('N13').split(' — ');
    expect(SECTION_8).toContain(`"${before}`);
    expect(SECTION_8).toContain(`— ${after}"`);
  });

  it('N9 is §8 word for word, both halves', () => {
    expect(SECTION_8).toContain(
      `"${body('N9', 'check-in')}" / "${body('N9', 'check-out').replace(/’/g, "'")}"`,
    );
  });

  it('E2 is §8 word for word', () => {
    expect(SECTION_8).toContain(`"${body('E2')}"`);
  });

  it('E4 is the §10.1 "Unsuccessful" wording word for word', () => {
    expect(WHOLE).toContain(`Assessment — Unsuccessful. ${asScope(body('E4'))}`);
  });

  it('E8 and E9 carry the §8 subjects', () => {
    expect(SECTION_8).toContain('Subject "P45 requested — [name], Employee ID [id]"');
    // E9's subject is split by the page break, the table header between.
    expect(SECTION_8).toContain('Subject "Criminal mandatory');
    expect(SECTION_8).toContain('conviction declared — [name], Employee ID [id]"');
    expect(TEMPLATES.E8.title).toBe('P45 requested — {name}, Employee ID {employeeId}');
    expect(TEMPLATES.E9.title).toBe(
      'Criminal conviction declared — {name}, Employee ID {employeeId}',
    );
  });

  it('E5–E9 go to the addresses §8 names', () => {
    const payroll = ['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'];
    expect(TEMPLATES.E5.recipients).toEqual(payroll);
    expect(TEMPLATES.E6.recipients).toEqual(payroll);
    expect(TEMPLATES.E7.recipients).toEqual([
      'admin@thehospitalitycompany.co.uk',
      'thc_payroll@topsourceworldwide.com',
    ]);
    expect(TEMPLATES.E8.recipients).toEqual(['admin@thehospitalitycompany.co.uk']);
    expect(TEMPLATES.E9.recipients).toEqual(['admin@thehospitalitycompany.co.uk']);
    for (const address of [...payroll, 'admin@thehospitalitycompany.co.uk']) {
      expect(SECTION_8).toContain(address);
    }
  });
});
