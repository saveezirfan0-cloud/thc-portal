import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RadarRow } from '../types';

/**
 * §4.1 / §1.8 — a Radar row says who verified the document and when, in UK
 * time, like every other screen that shows a verified document.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { RadarTab } = await import('../RadarTab');

const ROW: RadarRow = {
  staff_id: 's1',
  display_name: 'Tom Radar',
  employee_id: 1,
  rtw_branch: 'uk_irish',
  status: 'compliant',
  block_kind: null,
  photo_path: null,
  doc_id: 'd1',
  doc_type: 'passport',
  doc_label: 'Passport',
  expires_on: '2027-03-11',
  days_left: 154,
  state: 'valid',
  n1_at: null,
  n2_at: null,
  n3_at: null,
  n4_at: null,
  replacement_in_review: false,
  reviewed_at: '2026-10-08T10:05:00Z',
  reviewed_by_name: 'Gisela M.',
};

const render = (rows: RadarRow[]) =>
  renderToStaticMarkup(<RadarTab rows={rows} warnings={[]} mode="block" />);

describe('Radar · who verified the document', () => {
  it('names the verifier and the UK-time stamp under the document', () => {
    expect(render([ROW])).toContain('Verified by Gisela M. · 08.10.2026 11:05 UK time');
  });

  it('with no name on file still shows when', () => {
    const html = render([{ ...ROW, reviewed_by_name: null }]);
    expect(html).toContain('Verified · 08.10.2026 11:05 UK time');
    expect(html).not.toContain('Verified by');
  });

  it('says nothing about a verifier it has no time for', () => {
    const html = render([{ ...ROW, reviewed_at: null, reviewed_by_name: null }]);
    expect(html).not.toContain('Verified');
  });
});
