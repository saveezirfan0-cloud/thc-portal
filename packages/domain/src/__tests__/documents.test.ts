import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DOC_LABELS,
  DOC_TYPES,
  canActOnDocuments,
  canDeclareConviction,
  documentFolder,
  documentState,
  parseShareCode,
  termLetterDatesVerdict,
  termLetterExpired,
  termLetterExpiresOn,
  termLetterFallbackExpiry,
  termLetterLastDay,
  usesGenericUpload,
} from '../documents';
import type { TermRange } from '../documents';
import termLetterVectors from '../termLetter.vectors.json' with { type: 'json' };
import { formatShareCode } from '../shareCode';
import { evidenceObjectPath } from '../completionLetter';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../../supabase/migrations');

describe('the doc_type enum', () => {
  it('matches 0001_init exactly — a type the app does not know would render as nothing', () => {
    const sql = readFileSync(resolve(migrations, '0001_init.sql'), 'utf8');
    const body = /create type doc_type as enum \(([^)]*)\)/.exec(sql)![1]!;
    const values = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...DOC_TYPES]);
  });

  it('labels every type the way doc_label() does, so the push and the row agree', () => {
    const sql = readFileSync(resolve(migrations, '20260921170411_compliance_daily.sql'), 'utf8');
    for (const type of DOC_TYPES) {
      expect(sql).toContain(`when '${type}'`);
      expect(sql).toContain(`then '${DOC_LABELS[type]}'`);
    }
  });
});

describe('who may upload or declare from the app', () => {
  it('a compliant worker may', () => {
    expect(canActOnDocuments('compliant', null)).toBe(true);
  });

  it('a worker locked to Documents may (§10.1 case 1)', () => {
    expect(canActOnDocuments('blocked', 'auto_document')).toBe(true);
    expect(canDeclareConviction('blocked', 'conviction_review')).toBe(true);
  });

  it('a manual hold may not — nothing for the worker to fix, and a declaration would soften the block', () => {
    expect(canActOnDocuments('blocked', 'manual')).toBe(false);
    expect(canDeclareConviction('blocked', 'manual')).toBe(false);
  });

  it('a candidate, a leaver and a removed account may not', () => {
    for (const status of ['documents', 'quiz', 'inactive', 'removed', 'rejected'] as const) {
      expect(canActOnDocuments(status, null)).toBe(false);
    }
  });
});

describe('where an upload goes', () => {
  it('one folder per document type, the path evidence_upload_problem() checks', () => {
    expect(documentFolder('visa_document')).toBe('visa-document');
    expect(evidenceObjectPath('s1', documentFolder('passport'), 'abc', 'Scan.JPG')).toBe(
      's1/passport/abc.jpg',
    );
  });

  it('the completion letter is not a generic upload', () => {
    expect(usesGenericUpload('university_completion_letter')).toBe(false);
    expect(usesGenericUpload('passport')).toBe(true);
  });
});

describe('share codes', () => {
  it('accepts gov.uk’s spacing and case, and stores the nine characters', () => {
    expect(parseShareCode('w98 7zy 6xk')).toBe('W987ZY6XK');
    expect(formatShareCode('W987ZY6XK')).toBe('W98 7ZY 6XK');
  });

  it('refuses anything that is not nine characters starting with W — the wizard’s rule', () => {
    expect(parseShareCode('W98 7ZY')).toBeNull();
    expect(parseShareCode('W98 7ZY 6XK1')).toBeNull();
    expect(parseShareCode('A98 7ZY 6XK')).toBeNull();
  });
});

describe('documentState — §4.4', () => {
  const today = '2026-09-23';
  const row = (over: Partial<Parameters<typeof documentState>[0]> = {}) => ({
    docType: 'passport' as const,
    reviewStatus: 'verified' as const,
    expiresOn: '2031-03-14' as string | null,
    ...over,
  });

  it('verified with an expiry more than 30 days out', () => {
    expect(documentState(row(), today)).toBe('verified');
    expect(documentState(row({ expiresOn: null }), today)).toBe('verified');
  });

  it('expiring inside the 30 days N1 opens', () => {
    expect(documentState(row({ expiresOn: '2026-10-23' }), today)).toBe('expiring');
    expect(documentState(row({ expiresOn: '2026-10-24' }), today)).toBe('verified');
  });

  it('expired ON the expiry day — the day N4 fires and the block lands', () => {
    expect(documentState(row({ expiresOn: today }), today)).toBe('expired');
    expect(documentState(row({ expiresOn: '2026-09-17' }), today)).toBe('expired');
  });

  it('pending, rejected and superseded are read straight off the review status', () => {
    expect(documentState(row({ reviewStatus: 'pending' }), today)).toBe('in_review');
    expect(documentState(row({ reviewStatus: 'rejected' }), today)).toBe('rejected');
    expect(documentState(row({ reviewStatus: 'superseded', expiresOn: '2020-01-01' }), today)).toBe(
      'superseded',
    );
  });

  it('a graduate’s term letter is not needed, never expired (§4.5)', () => {
    const letter = row({ docType: 'university_term_dates_letter', expiresOn: '2025-12-31' });
    expect(documentState(letter, today, false)).toBe('not_needed');
    expect(documentState(letter, today, true)).toBe('expired');
  });
});

describe('§4.2 an already-expired term-dates letter is not accepted', () => {
  it.each(termLetterVectors.cases)('$name', ({ today, ranges, expect: expected }) => {
    expect(termLetterDatesVerdict(today, ranges as TermRange[] | null)).toBe(expected);
  });

  it('termLetterExpired is true for the refusal only, never for the uncertainty', () => {
    expect(termLetterExpired('2026-09-25', [{ from: '2026-06-13', to: '2026-09-24' }])).toBe(true);
    expect(termLetterExpired('2026-09-25', [{ from: '2026-06-13', to: '2026-09-25' }])).toBe(false);
    expect(termLetterExpired('2026-09-25', [])).toBe(false);
    expect(termLetterExpired('2026-09-25', null)).toBe(false);
  });

  it('is judged on the printed dates, whatever expiry the row carries', () => {
    // Every date on it is last year's, so the refusal fires however the
    // row's own expiry reads.
    expect(
      documentState(
        {
          docType: 'university_term_dates_letter',
          reviewStatus: 'pending',
          expiresOn: '2026-12-31',
        },
        '2026-09-25',
      ),
    ).toBe('in_review');
    expect(termLetterExpired('2026-09-25', [{ from: '2025-06-14', to: '2025-09-21' }])).toBe(true);
  });

  it('the SQL twin refuses Verify and flags the extraction with the same rule (20260928110300)', () => {
    const sql = readFileSync(
      resolve(migrations, '20260928110300_term_letter_dates_in_the_future.sql'),
      'utf8',
    );
    expect(sql).toContain('create or replace function public.term_letter_expired(');
    expect(sql).toContain("raise exception 'term_letter_expired");
    expect(sql).toContain("'letter expired'");
  });
});

describe('when a term letter expires (ADR-0103)', () => {
  // The vacation ranges on a 2026/27 letter, as the extractor reads them.
  const academicYear: TermRange[] = [
    { from: '2026-12-19', to: '2027-01-10' },
    { from: '2027-03-27', to: '2027-04-18' },
    { from: '2027-06-19', to: '2027-09-26' },
  ];

  it('is the last day printed on the letter, not 31 December', () => {
    expect(termLetterLastDay(academicYear)).toBe('2027-09-26');
    expect(termLetterExpiresOn(academicYear, '2026-10-07')).toBe('2027-09-26');
  });

  it('does not depend on the order the ranges are listed, or on one typed backwards', () => {
    expect(termLetterLastDay([...academicYear].reverse())).toBe('2027-09-26');
    expect(termLetterLastDay([{ from: '2027-09-26', to: '2027-06-19' }])).toBe('2027-09-26');
  });

  it('lets the letter outlive 31 December, which is the point of the change', () => {
    // Uploaded in October, valid into the next autumn: no December reminder.
    expect(termLetterExpiresOn(academicYear, '2026-10-07') > '2026-12-31').toBe(true);
  });

  it('a letter that stops at Christmas expires then, and is chased for the next one', () => {
    expect(termLetterExpiresOn([{ from: '2026-12-19', to: '2027-01-10' }], '2026-10-07')).toBe(
      '2027-01-10',
    );
  });

  it('with no readable dates, falls back to the calendar rule of ADR-0011', () => {
    expect(termLetterLastDay([])).toBeNull();
    expect(termLetterLastDay(null)).toBeNull();
    expect(termLetterExpiresOn([], '2026-10-07')).toBe('2026-12-31');
    expect(termLetterExpiresOn(undefined, '2026-11-02')).toBe('2027-12-31');
    expect(termLetterFallbackExpiry('2026-10-31')).toBe('2026-12-31');
    expect(termLetterFallbackExpiry('2026-11-01')).toBe('2027-12-31');
    expect(termLetterFallbackExpiry('2026-12-05')).toBe('2027-12-31');
  });

  it('feeds the §4.4 state: expiring in the month before the last printed day', () => {
    const row = (expiresOn: string) => ({
      docType: 'university_term_dates_letter' as const,
      reviewStatus: 'verified' as const,
      expiresOn,
    });
    const expiresOn = termLetterExpiresOn(academicYear, '2026-10-07');
    expect(documentState(row(expiresOn), '2027-08-26')).toBe('verified');
    expect(documentState(row(expiresOn), '2027-08-27')).toBe('expiring');
    expect(documentState(row(expiresOn), '2027-09-26')).toBe('expired');
  });

  it('the SQL twin gives the letter its last printed day, with the calendar rule as the fallback', () => {
    const sql = readFileSync(
      resolve(migrations, '20261007130000_term_letter_expires_with_its_own_dates.sql'),
      'utf8',
    );
    expect(sql).toContain('select max(upper(r) - 1)');
    expect(sql).toContain('term_letter_last_day(p_term_dates)');
    expect(sql).toContain('extract(month from d) >= 11');
  });
});
