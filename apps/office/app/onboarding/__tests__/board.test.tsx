import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CandidateRow } from '../types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../actions', () => ({ resolveReturning: vi.fn() }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));

const { OnboardingBoard } = await import('../OnboardingBoard');

/**
 * /onboarding against its wireframe (audit screens item): the onboarding
 * selfie on the card, no builder annotations on the screen, Willo's
 * not-connected state as a neutral disabled line.
 */
function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 'c-1',
    display_name: 'Hana Kowalska',
    email: 'hana.k@example.com',
    phone: '+44 7700 900456',
    photo_path: 'c-1/selfie.jpg',
    photo_url: 'https://signed.example/c-1',
    status: 'interview_requested',
    stage_entered_at: '2026-09-20T09:00:00Z',
    onboarding_started_at: '2026-09-10T08:58:00Z',
    applied_at: '2026-09-10T08:58:00Z',
    role_names: [],
    role_ids: [],
    willo_linked: false,
    willo_review_url: null,
    docs_total: 0,
    docs_verified: 0,
    docs_pending: 0,
    docs_rejected: 0,
    docs_missing: [],
    quiz_blockers: [],
    quiz_attempts_used: 0,
    rejection_cause: null,
    rejected_at: null,
    ...over,
  } as unknown as CandidateRow;
}

const render = (rows: CandidateRow[]) =>
  renderToStaticMarkup(
    <OnboardingBoard
      data={{ candidates: rows, returning: [], roles: [], problem: null }}
      now="2026-09-23T10:00:00Z"
      applyUrl={null}
    />,
  );

describe('the onboarding board', () => {
  it('shows the candidate’s selfie on the card, signed on the server', () => {
    expect(render([candidate()])).toContain('src="https://signed.example/c-1"');
  });

  it('falls back to initials when there is no selfie yet', () => {
    const html = render([candidate({ photo_path: null, photo_url: null })]);
    expect(html).not.toContain('src="https://signed.example');
    expect(html).toContain('HK');
  });

  it('shows Willo not connected as a neutral, disabled line', () => {
    const html = render([candidate()]);
    expect(html).toMatch(
      /class="willo off" aria-disabled="true"[^>]*>Review interview on Willo — not connected</,
    );
    expect(html).not.toMatch(/willo off[^"]*coral/);
  });

  it('renders no builder annotations', () => {
    const html = render([candidate()]);
    expect(html).not.toContain('class="annot');
  });
});
