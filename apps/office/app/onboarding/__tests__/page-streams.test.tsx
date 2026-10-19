import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { prerenderToNodeStream } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /onboarding and /onboarding/:id paint their shell at once and stream the
 * heavy read behind it (ADR-0161): the pipeline view (go-live audit H3) and
 * the candidate's sixteen reads. What ADR-0109 guards is kept: an unknown
 * candidate is a REAL 404 decided before any boundary streams, a failed
 * read is a message, and there is one `OfficeShell`.
 */
const state = vi.hoisted(() => ({
  board: null as null | (() => Promise<unknown>),
  head: null as unknown,
  record: null as null | (() => Promise<unknown>),
  startedBeforeHead: -1,
  started: 0,
  shells: 0,
  props: [] as Record<string, unknown>[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../data', () => ({
  loadBoard: () => state.board!(),
  loadCandidate: () => {
    state.started += 1;
    return state.record!();
  },
}));
vi.mock('../head', () => ({
  loadCandidateHead: async () => {
    state.startedBeforeHead = state.started;
    return state.head;
  },
}));
vi.mock('../../_components/officeUser', () => ({ currentOfficeRole: async () => 'owner' }));
vi.mock('../OnboardingBoard', () => ({
  OnboardingBoard: (props: Record<string, unknown>) => {
    state.props.push(props);
    return <div>the board</div>;
  },
}));
vi.mock('../CandidateScreen', () => ({
  CandidateScreen: (props: Record<string, unknown>) => {
    state.props.push(props);
    return <div>the candidate</div>;
  },
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({
    title,
    crumbs,
    children,
  }: {
    title: ReactNode;
    crumbs?: ReactNode;
    children: ReactNode;
  }) => {
    state.shells += 1;
    return (
      <main>
        <h1>{title}</h1>
        <nav>{crumbs}</nav>
        {children}
      </main>
    );
  },
}));

const { default: BoardPage } = await import('../page');
const { default: CandidatePage } = await import('../[id]/page');

const never = () => new Promise(() => {});
const text = (html: string) => html.replace(/<!-- -->/g, '');
async function settled(node: ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node);
  let html = '';
  for await (const chunk of prelude) html += String(chunk);
  return text(html);
}

beforeEach(() => {
  state.started = 0;
  state.startedBeforeHead = -1;
  state.shells = 0;
  state.props = [];
  state.board = never;
  state.record = never;
});

describe('/onboarding', () => {
  it('draws the shell and the six columns while the pipeline is read', () => {
    const html = text(renderToString(<BoardPage />));
    expect(html).toContain('<h1>Onboarding</h1>');
    expect(html).toContain('Loading the candidate pipeline');
    for (const column of ['Interview requested', 'Documents', 'Contract']) {
      expect(html).toContain(column);
    }
    expect(html).not.toContain('the board');
    expect(state.shells).toBe(1);
  });

  it('streams in the board, bare, and the counts into the topbar', async () => {
    state.board = async () => ({
      candidates: [{ id: 'c1', status: 'documents' }],
      returning: [],
      roles: [],
      problem: null,
    });
    const html = await settled(<BoardPage />);
    expect(html).toContain('the board');
    expect(html).toContain('<b>1 active</b> · 0 rejected');
    expect(state.props.at(-1)).toMatchObject({ bare: true });
    expect(state.shells).toBe(1);
  });
});

describe('/onboarding/:id', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it('answers an unknown candidate with notFound() before anything streams', async () => {
    state.head = { candidate: null, problem: null };
    await expect(CandidatePage(params('nobody'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  it('a candidate who cannot be read is a message, not a 404', async () => {
    state.head = { candidate: null, problem: 'The pipeline could not be read.' };
    const html = renderToString(await CandidatePage(params('c1')));
    expect(html).toContain('The pipeline could not be read.');
  });

  it('starts the record before the head, and paints the name over a skeleton', async () => {
    state.head = { candidate: { id: 'c1', display_name: 'Hana K.' }, problem: null };
    const html = text(renderToString(await CandidatePage(params('c1'))));
    expect(state.startedBeforeHead).toBe(1);
    expect(html).toContain('<b>Hana K.</b>');
    expect(html).toContain('Loading the candidate');
    expect(html).not.toContain('the candidate</div>');
  });

  it('streams the record in, bare, inside the one shell', async () => {
    state.head = { candidate: { id: 'c1', display_name: 'Hana K.' }, problem: null };
    state.record = async () => ({ candidate: { id: 'c1' }, problem: null });
    const html = await settled(await CandidatePage(params('c1')));
    expect(html).toContain('the candidate');
    expect(state.props.at(-1)).toMatchObject({ bare: true, canMarkInterview: true });
    expect(state.shells).toBe(1);
  });
});
