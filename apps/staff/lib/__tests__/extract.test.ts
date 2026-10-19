import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ExtractorModule from '../../app/onboarding/extractor';
import type { DocumentExtractor } from '../../app/onboarding/extractor';

/**
 * lib/extract.ts with the Claude provider behind it (ADR-0033): a failed
 * read still writes a zero-confidence row, so `record_document_extraction()`
 * flags it for manual review on every upload path; no provider → nothing
 * is written at all. No network, no database: both are fakes.
 */

const state: { extractor: DocumentExtractor | null } = { extractor: null };

vi.mock('../../app/onboarding/extractor', async (importOriginal) => {
  const actual = await importOriginal<typeof ExtractorModule>();
  return { ...actual, documentExtractor: () => state.extractor };
});

const { extractDocument } = await import('../extract');

function fakeAdmin() {
  const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
  const download = vi.fn(async () => ({
    data: new Blob([new TextEncoder().encode('%PDF-1.7 synthetic')], { type: 'application/pdf' }),
    error: null,
  }));
  const admin = { rpc, storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
  return { admin, rpc, download };
}

beforeEach(() => {
  state.extractor = null;
});

describe('extractDocument', () => {
  it('writes nothing when no extractor is configured', async () => {
    const { admin, rpc, download } = fakeAdmin();
    await extractDocument(admin, 'doc-1', 'passport', 'staff/s1/p.pdf', 'application/pdf');
    expect(download).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('records a failed read as confidence 0 — flagged for manual review', async () => {
    state.extractor = {
      provider: 'anthropic',
      extract: async () => ({
        expiryDate: null,
        holidays: null,
        completionDate: null,
        awardingInstitution: null,
        confidence: 0,
        raw: { model: 'claude-sonnet-5', docType: 'passport', error: 'timeout' },
      }),
    };
    const { admin, rpc } = fakeAdmin();
    await extractDocument(admin, 'doc-1', 'passport', 'staff/s1/p.pdf', 'application/pdf');
    expect(rpc).toHaveBeenCalledWith('record_document_extraction', {
      p_doc: 'doc-1',
      p_expiry: null,
      p_term_dates: null,
      p_completion: null,
      p_institution: null,
      p_confidence: 0,
      p_raw: {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        docType: 'passport',
        error: 'timeout',
      },
    });
  });

  it('passes term-letter holidays as half-open Postgres ranges', async () => {
    state.extractor = {
      provider: 'anthropic',
      extract: async () => ({
        expiryDate: null,
        holidays: [{ from: '2026-12-19', to: '2027-01-10' }],
        completionDate: null,
        awardingInstitution: null,
        confidence: 0.93,
        raw: {},
      }),
    };
    const { admin, rpc } = fakeAdmin();
    await extractDocument(admin, 'doc-2', 'university_term_dates_letter', 'staff/s1/t.pdf');
    expect(rpc).toHaveBeenCalledWith(
      'record_document_extraction',
      expect.objectContaining({ p_term_dates: ['[2026-12-19,2027-01-11)'], p_confidence: 0.93 }),
    );
  });

  it('puts a read passport country on the worker through record_passport_country (ADR-0159)', async () => {
    state.extractor = {
      provider: 'anthropic',
      extract: async () => ({
        expiryDate: '2031-03-12',
        holidays: null,
        completionDate: null,
        awardingInstitution: null,
        passportCountry: 'Poland',
        confidence: 0.95,
        raw: {},
      }),
    };
    const { admin, rpc } = fakeAdmin();
    await extractDocument(admin, 'doc-3', 'passport', 'staff/s1/p.jpg', 'image/jpeg');
    expect(rpc).toHaveBeenCalledWith('record_passport_country', {
      p_doc: 'doc-3',
      p_country: 'Poland',
    });
  });

  it('calls nothing more when no passport country was read, or the document is not a passport', async () => {
    for (const [docType, passportCountry] of [
      ['passport', null],
      ['national_id', 'Poland'],
    ] as const) {
      state.extractor = {
        provider: 'anthropic',
        extract: async () => ({
          expiryDate: '2031-03-12',
          holidays: null,
          completionDate: null,
          awardingInstitution: null,
          passportCountry,
          confidence: 0.95,
          raw: {},
        }),
      };
      const { admin, rpc } = fakeAdmin();
      await extractDocument(admin, 'doc-4', docType, 'staff/s1/p.jpg', 'image/jpeg');
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith('record_document_extraction', expect.anything());
    }
  });
});
