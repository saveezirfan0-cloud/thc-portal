import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BoardData, CandidateRow, ChaserState } from '../types';

/**
 * Onboarding chasers on the office board (ADR-0071): the reminder a
 * candidate has been sent, and "Stalled" once all three have gone with no
 * progress. Read through onboarding_chaser_state(), a separate admin read.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../actions', () => ({ resolveReturning: vi.fn() }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const { chaserLine } = await import('../view-model');
const { loadBoardChasers } = await import('../data');
const { OnboardingBoard } = await import('../OnboardingBoard');

function state(over: Partial<ChaserState> = {}): ChaserState {
  return {
    staff_id: 'c-1',
    track: 'app',
    step: 'your home address',
    progress_at: '2026-09-20T09:00:00Z',
    rungs_sent: 1,
    last_sent_at: '2026-09-22T11:00:00Z',
    next_due_at: '2026-09-25T11:00:00Z',
    stalled: false,
    last_failed: false,
    ...over,
  };
}

describe('chaserLine()', () => {
  it('says nothing before the first reminder', () => {
    expect(chaserLine(undefined)).toBeNull();
    expect(chaserLine(state({ rungs_sent: 0, last_sent_at: null }))).toBeNull();
  });

  it('names the reminder, how it went, when, and when the next is due', () => {
    expect(chaserLine(state())).toEqual({
      text: 'App reminder 1 pushed 22 Sep · next 25 Sep',
      tone: 'muted',
    });
    expect(chaserLine(state({ track: 'interview', rungs_sent: 2 }))?.text).toBe(
      'Interview reminder 2 emailed 22 Sep · next 25 Sep',
    );
    expect(chaserLine(state({ track: 'activation' }))?.text).toBe(
      'Set-up reminder 1 emailed with a new link 22 Sep · next 25 Sep',
    );
  });

  it('turns amber when the latest could not be delivered: they have not been reminded at all', () => {
    expect(chaserLine(state({ last_failed: true }))).toEqual({
      text: 'App reminder 1 not delivered 22 Sep — notifications are off on their phone. Phone them.',
      tone: 'amber',
    });
    expect(chaserLine(state({ track: 'interview', last_failed: true }))?.text).toContain(
      'the email bounced',
    );
  });

  it("says a stalled card's last reminder was undelivered, too", () => {
    expect(
      chaserLine(state({ rungs_sent: 3, stalled: true, next_due_at: null, last_failed: true }))
        ?.text,
    ).toBe(
      'Stalled — no progress after 3 reminders (last 22 Sep, the last undelivered — notifications are off on their phone), still reminding daily. Phone them.',
    );
  });

  it('turns coral once three have gone with no progress, and says they carry on', () => {
    expect(chaserLine(state({ rungs_sent: 3, stalled: true, next_due_at: null }))).toEqual({
      text: 'Stalled — no progress after 3 reminders (last 22 Sep), still reminding daily. Phone them.',
      tone: 'coral',
    });
  });
});

describe('loadBoardChasers()', () => {
  it('keys the rows by candidate', async () => {
    const rows = [state(), state({ staff_id: 'c-2', stalled: true, rungs_sent: 3 })];
    const reader = { rpc: vi.fn(async () => ({ data: rows, error: null })) };
    const { chasers, problem } = await loadBoardChasers(reader);
    expect(reader.rpc).toHaveBeenCalledWith('onboarding_chaser_state');
    expect(problem).toBeNull();
    expect(Object.keys(chasers)).toEqual(['c-1', 'c-2']);
    expect(chasers['c-2']!.stalled).toBe(true);
  });

  it('reports a failed read as a problem, not as "never reminded"', async () => {
    const reader = { rpc: async () => ({ data: null, error: { message: 'forbidden' } }) };
    expect(await loadBoardChasers(reader)).toEqual({ chasers: {}, problem: 'forbidden' });
    const throwing = {
      rpc: async (): Promise<never> => {
        throw new Error('fetch failed');
      },
    };
    expect(await loadBoardChasers(throwing)).toEqual({ chasers: {}, problem: 'fetch failed' });
  });
});

function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 'c-1',
    display_name: 'Amy App',
    email: 'amy@example.com',
    phone: '+44 7700 900456',
    photo_path: null,
    photo_url: null,
    status: 'quiz',
    stage_entered_at: '2026-09-20T09:00:00Z',
    onboarding_started_at: '2026-09-10T08:58:00Z',
    applied_at: '2026-09-10T08:58:00Z',
    role_names: [],
    role_ids: [],
    willo_linked: true,
    willo_review_url: null,
    docs_total: 0,
    docs_verified: 0,
    docs_pending: 0,
    docs_rejected: 0,
    docs_missing: [],
    quiz_blockers: [],
    quiz_attempts_used: 0,
    quiz_scores: [],
    rejection_cause: null,
    rejected_at: null,
    ...over,
  } as unknown as CandidateRow;
}

const render = (data: Partial<BoardData>) =>
  renderToStaticMarkup(
    <OnboardingBoard
      data={{ candidates: [candidate()], returning: [], roles: [], problem: null, ...data }}
      now="2026-09-30T10:00:00Z"
      applyUrl={null}
    />,
  );

describe('the board', () => {
  it('shows a stalled candidate in coral on their card', () => {
    const html = render({
      chasers: { 'c-1': state({ rungs_sent: 3, stalled: true, next_due_at: null }) },
    });
    expect(html).toMatch(/class="meta coral">Stalled — no progress after 3 reminders/);
  });

  it('draws no reminder line for a candidate nobody has chased', () => {
    expect(render({ chasers: {} })).not.toContain('reminder');
  });

  it('says so when the reminders could not be read', () => {
    expect(render({ chasersProblem: 'forbidden' })).toContain(
      'The onboarding reminders could not be read',
    );
  });
});
