import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  BoardData,
  CandidateRow,
  UnmatchedLinkResult,
  UnmatchedWilloRead,
  UnmatchedWilloRow,
} from '../types';

/**
 * "Unmatched Willo responses" on /onboarding (ADR-0087): the read, what the
 * panel says in each state, who can be linked, and what linking will do.
 * Rendered to markup (the office tests have no DOM), so the dialogs are
 * checked through their exported bodies.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../actions', () => ({
  resolveReturning: vi.fn(),
  linkUnmatchedWillo: vi.fn(),
  dismissUnmatchedWillo: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const { loadUnmatchedWillo } = await import('../data');
const { OnboardingBoard } = await import('../OnboardingBoard');
const { LinkPicker, UnmatchedWilloPanel } = await import('../UnmatchedWilloPanel');
const {
  LINKABLE_STATUSES,
  linkConsequence,
  linkOptions,
  linkedMessage,
  seenLine,
  shortKey,
  unmatchedEventLabel,
  unmatchedEventTone,
  unmatchedHeading,
} = await import('../unmatched');

const KEY = '5b046807a81e41278fa24f0e8ad8f3fb';

function row(over: Partial<UnmatchedWilloRow> = {}): UnmatchedWilloRow {
  return {
    willo_candidate_id: KEY,
    first_seen: '2026-10-04T21:58:00Z',
    last_seen: '2026-10-04T21:58:30Z',
    event_count: 2,
    events: ['received', 'new_response'],
    name: 'Oluwafunmi Shosanya',
    email: 'funmi@example.com',
    review_url: `https://app.willo.video/review/${KEY}`,
    resolved: false,
    resolution: null,
    resolved_at: null,
    resolved_by_name: null,
    resolution_reason: null,
    staff_id: null,
    ...over,
  };
}

function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 'c-1',
    display_name: 'Hana Kowalska',
    email: 'hana.k@example.com',
    phone: '+44 7700 900456',
    status: 'interview_requested',
    applied_at: '2026-09-10T08:58:00Z',
    stage_entered_at: '2026-09-10T08:58:00Z',
    onboarding_started_at: '2026-09-10T08:58:00Z',
    willo_linked: false,
    willo_review_url: null,
    role_names: [],
    role_ids: [],
    ...over,
  } as unknown as CandidateRow;
}

const render = (read: UnmatchedWilloRead | undefined, canResolve = true, rows = [candidate()]) =>
  renderToStaticMarkup(
    <UnmatchedWilloPanel read={read} candidates={rows} canResolve={canResolve} />,
  );

describe('the read', () => {
  it('asks for the unresolved rows and keeps only those', async () => {
    const rpc = vi.fn(async () => ({
      data: [row(), row({ willo_candidate_id: 'b', resolved: true, resolution: 'dismissed' })],
      error: null,
    }));
    const read = await loadUnmatchedWillo({ rpc });
    expect(rpc).toHaveBeenCalledWith('willo_unmatched_responses', { p_include_resolved: false });
    expect(read.problem).toBeNull();
    expect(read.rows.map((r) => r.willo_candidate_id)).toEqual([KEY]);
  });

  it('says the read failed, in the database’s words — never "none"', async () => {
    const failed = await loadUnmatchedWillo({
      rpc: async () => ({ data: null, error: { message: 'permission denied' } }),
    });
    expect(failed).toEqual({ rows: [], problem: 'permission denied' });
    const thrown = await loadUnmatchedWillo({
      rpc: async () => {
        throw new Error('network down');
      },
    });
    expect(thrown.problem).toBe('network down');
  });
});

describe('the panel, state by state', () => {
  it('renders nothing when there is nothing unresolved (or no read at all)', () => {
    expect(render({ rows: [], problem: null })).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('says out loud when the read failed', () => {
    const html = render({ rows: [], problem: 'permission denied' });
    expect(html).toContain('alert coral');
    expect(html).toContain('could not be read');
    expect(html).toContain('permission denied');
  });

  it('says when this environment has no Supabase project', () => {
    const html = render({ rows: [], problem: 'x', noProject: true });
    expect(html).toContain('no Supabase project');
    expect(html).not.toContain('alert coral');
  });

  it('lists each response: who, the events, when (UK time), the Willo link and the actions', () => {
    const html = render({ rows: [row()], problem: null });
    expect(html).toContain('Unmatched Willo responses');
    expect(html).toContain('1 Willo response matches no candidate');
    expect(html).toContain('Oluwafunmi Shosanya');
    expect(html).toContain('funmi@example.com');
    expect(html).toContain('Willo key 5b04…f3fb');
    expect(html).toContain('Interview completed');
    expect(html).toContain('Seen 4 Oct 22:58 (UK time)');
    expect(html).toContain(`href="https://app.willo.video/review/${KEY}"`);
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('Open in Willo');
    expect(html).toContain('Link to candidate');
    expect(html).toContain('Dismiss');
  });

  it('is honest about a delivery that named nobody, and a Willo link that is not set', () => {
    const html = render({
      rows: [row({ name: null, email: null, review_url: null })],
      problem: null,
    });
    expect(html).toContain('Name not in the delivery');
    expect(html).toContain('Willo link not set');
    expect(html).not.toContain('Open in Willo');
  });

  it('offers the actions to an owner or manager only', () => {
    const html = render({ rows: [row()], problem: null }, false);
    expect(html).not.toContain('Link to candidate');
    expect(html).not.toContain('>Dismiss<');
    expect(html).toContain('An owner or manager resolves these.');
    expect(html).toContain('Open in Willo');
  });

  it('sits on the board, above the toolbar, and the board stays quiet without it', () => {
    const data = (unmatchedWillo?: UnmatchedWilloRead): BoardData => ({
      candidates: [],
      returning: [],
      roles: [],
      unmatchedWillo,
      problem: null,
    });
    const withRow = renderToStaticMarkup(
      <OnboardingBoard
        data={data({ rows: [row()], problem: null })}
        now="2026-10-05T10:00:00Z"
        applyUrl={null}
        canResolveUnmatched
      />,
    );
    expect(withRow).toContain('Unmatched Willo responses');
    expect(withRow.indexOf('Unmatched Willo responses')).toBeLessThan(
      withRow.indexOf('Search candidates'),
    );
    const without = renderToStaticMarkup(
      <OnboardingBoard data={data()} now="2026-10-05T10:00:00Z" applyUrl={null} />,
    );
    expect(without).not.toContain('Unmatched Willo responses');
  });
});

describe('the link dialog', () => {
  const body = (over: Partial<Parameters<typeof LinkPicker>[0]> = {}) =>
    renderToStaticMarkup(
      <LinkPicker
        events={['new_response']}
        options={[]}
        boardEmpty={false}
        query=""
        onQuery={() => {}}
        chosen={null}
        onChoose={() => {}}
        busy={false}
        {...over}
      />,
    );

  it('offers the candidates it found as a radio group, suggested ones marked', () => {
    const options = linkOptions(
      [candidate(), candidate({ id: 'c-2', display_name: 'Oluwafunmi Shosanya', email: 'x@y.co' })],
      row(),
      '',
    );
    const html = body({ options, chosen: 'c-2' });
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('Matches the Willo details');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Interview requested');
    expect(html).toContain('moves to Interview completed');
    expect(html).toContain('second Willo invitation');
  });

  it('says why nobody can be chosen', () => {
    expect(body()).toContain('No candidate waiting on the interview matches');
    expect(body({ boardEmpty: true })).toContain('There are no candidates on the board');
  });

  it('disables the search while a link is in flight', () => {
    expect(body({ busy: true })).toContain('disabled');
  });
});

describe('who can be chosen', () => {
  const people = [
    candidate({
      id: 'a',
      display_name: 'Ana Acc',
      email: 'ana@willo.test',
      status: 'interview_requested',
    }),
    candidate({
      id: 'b',
      display_name: 'Ben Req',
      email: 'ben@willo.test',
      status: 'interview_completed',
    }),
    candidate({ id: 'c', display_name: 'Cal Linked', email: 'cal@willo.test', willo_linked: true }),
    candidate({ id: 'd', display_name: 'Dee Docs', email: 'dee@willo.test', status: 'documents' }),
    candidate({
      id: 'e',
      display_name: 'Eli Rejected',
      email: 'eli@willo.test',
      status: 'rejected',
    }),
  ];

  it('offers only those still waiting on the interview and not yet linked to Willo', () => {
    expect(LINKABLE_STATUSES).toEqual(['interview_requested', 'interview_completed']);
    expect(
      linkOptions(people, row({ name: null, email: null }), '')
        .map((o) => o.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('searches name, email and phone, ignoring case and accents', () => {
    expect(linkOptions(people, row(), 'BEN@').map((o) => o.id)).toEqual(['b']);
    expect(linkOptions(people, row(), 'ana').map((o) => o.id)).toEqual(['a']);
    expect(
      linkOptions(people, row(), '7700 900456')
        .map((o) => o.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(
      linkOptions([candidate({ display_name: 'Zoë Brontë' })], row(), 'zoe bronte'),
    ).toHaveLength(1);
  });

  it('puts a name or email match first — in either word order', () => {
    const ordered = linkOptions(people, row({ name: 'Req Ben', email: null }), '');
    expect(ordered.map((o) => o.id)).toEqual(['b', 'a']);
    expect(ordered[0]!.suggested).toBe(true);
    const byEmail = linkOptions(people, row({ name: null, email: 'ANA@willo.test' }), '');
    expect(byEmail[0]!.id).toBe('a');
    expect(byEmail[0]!.suggested).toBe(true);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      candidate({ id: `m${i}`, display_name: `P ${i}` }),
    );
    expect(linkOptions(many, row(), '')).toHaveLength(8);
    expect(linkOptions(many, row(), '', 3)).toHaveLength(3);
  });
});

describe('the words', () => {
  it('names the events THC knows and humanises the rest', () => {
    expect(unmatchedEventLabel('new_response')).toBe('Interview completed');
    expect(unmatchedEventLabel('accepted')).toBe('Accepted in Willo');
    expect(unmatchedEventLabel('rejected')).toBe('Rejected in Willo');
    expect(unmatchedEventLabel('some_new-event')).toBe('Some new event');
    expect(unmatchedEventLabel('')).toBe('Unnamed event');
    expect(unmatchedEventTone('accepted')).toBe('green');
    expect(unmatchedEventTone('rejected')).toBe('coral');
    expect(unmatchedEventTone('received')).toBe('neutral');
  });

  it('counts and shortens', () => {
    expect(unmatchedHeading(1)).toBe('1 Willo response matches no candidate');
    expect(unmatchedHeading(7)).toBe('7 Willo responses match no candidate');
    expect(shortKey(KEY)).toBe('5b04…f3fb');
    expect(shortKey('W-ana')).toBe('W-ana');
  });

  it('shows UK time for first and last seen (BST on 4 Oct)', () => {
    expect(
      seenLine(row({ first_seen: '2026-10-04T21:58:00Z', last_seen: '2026-10-04T21:58:00Z' })),
    ).toBe('Seen 4 Oct 22:58');
    expect(seenLine(row({ last_seen: '2026-10-05T08:00:00Z' }))).toBe(
      'First seen 4 Oct 22:58 · last 5 Oct 09:00',
    );
  });

  it('says what linking will do for what Willo said', () => {
    expect(linkConsequence(['new_response']).join(' ')).toMatch(/moves to Interview completed/);
    const accepted = linkConsequence(['new_response', 'accepted']).join(' ');
    expect(accepted).toMatch(/press Accept/);
    expect(accepted).toMatch(/E3/);
    const rejected = linkConsequence(['rejected']).join(' ');
    expect(rejected).toMatch(/rejects the candidate and sends them E2/);
    expect(rejected).not.toMatch(/press Accept/);
    expect(linkConsequence(['received']).join(' ')).toMatch(/no card moves/);
    expect(linkConsequence([]).at(-1)).toMatch(/second Willo invitation/);
  });

  it('tells the manager what happened to the card', () => {
    const link = (over: Partial<UnmatchedLinkResult>): UnmatchedLinkResult => ({
      outcome: 'linked',
      staffId: 's',
      ...over,
    });
    expect(
      linkedMessage(link({ acceptPending: true, status: 'interview_completed' }), 'Ana'),
    ).toMatch(/press Accept/);
    expect(linkedMessage(link({ status: 'rejected' }), 'Ana')).toMatch(
      /rejected, as Willo decided/,
    );
    expect(linkedMessage(link({ status: 'interview_completed' }), 'Ana')).toMatch(
      /moved to Interview completed/,
    );
    expect(linkedMessage(link({ status: 'interview_requested' }), 'Ana')).toBe(
      'Ana is linked to this Willo response.',
    );
    expect(linkedMessage(link({ outcome: 'already_linked' }), 'Ana')).toMatch(/already linked/);
  });
});
