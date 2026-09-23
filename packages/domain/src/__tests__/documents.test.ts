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
  usesGenericUpload,
} from '../documents';
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
