import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DeclarationRow, ProfileRow } from '../types';

/**
 * §1.8 — the Overview's "Criminal convictions · history" says who decided a
 * Yes declaration and when, in UK time, like the Documents tab does.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ saveEmergencyContact: vi.fn(), clearEmergencyContact: vi.fn() }));
vi.mock('../../../_lib/dobCorrectionActions', () => ({ correctDob: vi.fn() }));

const { Overview } = await import('../Overview');

const PROFILE = {
  id: 's1',
  display_name: 'Amara Kalu',
  status: 'compliant',
  removed: false,
  dob: '1995-01-01',
  joined_at: '2026-01-10T10:00:00Z',
  term_dates: [],
  wtr_optout: false,
} as unknown as ProfileRow;

const declaration = (over: Partial<DeclarationRow>): DeclarationRow => ({
  id: 'dc1',
  source: 'in_employment',
  answer: true,
  details: 'Minor motoring offence',
  conviction_date: null,
  review_status: 'verified',
  declared_at: '2026-10-07T09:00:00Z',
  reviewed_at: '2026-10-08T10:05:00Z',
  reviewed_by_name: 'Gisela M.',
  ...over,
});

const render = (declarations: DeclarationRow[]) =>
  renderToStaticMarkup(<Overview profile={PROFILE} references={[]} declarations={declarations} />);

describe('Overview · who decided a declaration (§1.8)', () => {
  it('names the verifier and the UK-time stamp', () => {
    expect(render([declaration({})])).toContain('Verified by Gisela M. · 08.10.2026 11:05 UK time');
  });

  it('names who rejected it', () => {
    expect(render([declaration({ review_status: 'rejected' })])).toContain(
      'Rejected by Gisela M. · 08.10.2026 11:05 UK time',
    );
  });

  it('says nothing about a decision on a declaration still under review, or an auto-verified No', () => {
    const html = render([
      declaration({ review_status: 'pending', reviewed_at: null, reviewed_by_name: null }),
      declaration({ id: 'dc2', answer: false, reviewed_at: null, reviewed_by_name: null }),
    ]);
    expect(html).not.toContain('Verified by');
    expect(html).not.toContain('Rejected by');
  });
});
