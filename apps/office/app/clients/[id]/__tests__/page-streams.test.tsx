import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { prerenderToNodeStream } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /clients/:id paints the shell, the client's name and "+ New event for
 * this client" at once and streams the card's dozen reads behind them
 * (ADR-0161). An unknown client is a REAL 404, decided from one row before
 * any boundary streams (ADR-0109); a failed read is a message.
 */
const state = vi.hoisted(() => ({
  head: null as unknown,
  card: null as null | (() => Promise<unknown>),
  started: 0,
  startedBeforeHead: -1,
  asked: [] as unknown[],
  shells: 0,
  props: [] as Record<string, unknown>[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../data', () => ({
  loadClientCard: (_id: string, options: unknown) => {
    state.started += 1;
    state.asked.push(options);
    return state.card!();
  },
}));
vi.mock('../head', () => ({
  loadClientHead: async () => {
    // A microtask later, as a real read would be: the card has started by now.
    await Promise.resolve();
    state.startedBeforeHead = state.started;
    return state.head;
  },
}));
vi.mock('../../../_components/officeUser', () => ({
  currentOfficeRole: async () => 'scheduler',
}));
vi.mock('../ClientCard', () => ({
  ClientCard: (props: Record<string, unknown>) => {
    state.props.push(props);
    return <div>the card</div>;
  },
}));
vi.mock('../../../_components/OfficeShell', () => ({
  OfficeShell: ({
    crumbs,
    actions,
    children,
  }: {
    crumbs?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
  }) => {
    state.shells += 1;
    return (
      <main>
        <nav>{crumbs}</nav>
        <div className="actions">{actions}</div>
        {children}
      </main>
    );
  },
}));

const { default: Page } = await import('../page');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
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
  state.asked = [];
  state.shells = 0;
  state.props = [];
  state.card = () => new Promise(() => {});
});

describe('/clients/:id streams the card behind its shell', () => {
  it('answers an unknown client with notFound() before anything streams', async () => {
    state.head = { client: null, problem: null };
    await expect(Page(params('nobody'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  it('a card that cannot be read is a message, not a 404', async () => {
    state.head = { client: null, problem: 'The client could not be read.' };
    const html = renderToString(await Page(params('c1')));
    expect(html).toContain('The client could not be read.');
  });

  it('starts the card with the head, and paints the name and New event over a skeleton', async () => {
    state.head = { client: { id: 'c1', name: 'Acme Hotels' }, problem: null };
    const html = text(renderToString(await Page(params('c1'))));
    expect(state.startedBeforeHead).toBe(1);
    // ADR-0061: a scheduler's card is read without rates.
    expect(state.asked).toEqual([{ ratesVisible: false }]);
    expect(html).toContain('<b>Acme Hotels</b>');
    expect(html).toContain('href="/events/new?client=c1"');
    expect(html).toContain('Loading the client card');
    expect(html).not.toContain('the card</div>');
    expect(state.shells).toBe(1);
  });

  it('streams the card in, bare, inside the one shell', async () => {
    state.head = { client: { id: 'c1', name: 'Acme Hotels' }, problem: null };
    state.card = async () => ({ client: { id: 'c1', name: 'Acme Hotels' }, problem: null });
    const html = await settled(await Page(params('c1')));
    expect(html).toContain('the card');
    expect(state.props.at(-1)).toMatchObject({ bare: true, ratesVisible: false, canWrite: true });
    expect(state.shells).toBe(1);
  });
});
