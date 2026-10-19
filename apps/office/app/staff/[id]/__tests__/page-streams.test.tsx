import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { prerenderToNodeStream } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /staff/:id paints the shell and the worker's name at once and streams the
 * profile's two dozen reads behind a skeleton (ADR-0161). What ADR-0109
 * guards is kept: an unknown worker is a REAL 404, decided from the
 * profile's first read before any boundary streams; a failed read is a
 * message, never a 404; there is one `OfficeShell`.
 */
const state = vi.hoisted(() => ({
  head: null as unknown,
  full: null as null | (() => Promise<unknown>),
  started: 0,
  startedBeforeHead: -1,
  shells: 0,
  screen: [] as Record<string, unknown>[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../head', () => ({
  loadProfileHead: async () => {
    state.startedBeforeHead = state.started;
    return state.head;
  },
}));
vi.mock('../data', () => ({
  loadProfile: () => {
    state.started += 1;
    return state.full!();
  },
}));
vi.mock('../../../_components/officeUser', () => ({
  currentOfficeRole: async () => 'manager',
}));
vi.mock('../ProfileScreen', () => ({
  ProfileScreen: (props: Record<string, unknown>) => {
    state.screen.push(props);
    return <div>profile body</div>;
  },
}));
vi.mock('../../../_components/OfficeShell', () => ({
  OfficeShell: ({ crumbs, children }: { crumbs?: ReactNode; children: ReactNode }) => {
    state.shells += 1;
    return (
      <main>
        <nav>{crumbs}</nav>
        {children}
      </main>
    );
  },
}));

const { default: Page } = await import('../page');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const ID = '20000000-0000-4000-8000-000000000001';
const NOBODY = '00000000-0000-4000-8000-000000000000';

const PROFILE = { id: 'w1', status: 'compliant', display_name: 'Amara Kalu', employee_id: 873 };

async function settled(node: ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node);
  let html = '';
  for await (const chunk of prelude) html += String(chunk);
  return html.replace(/<!-- -->/g, '');
}

beforeEach(() => {
  state.started = 0;
  state.shells = 0;
  state.screen = [];
  state.full = () => new Promise(() => {});
});

describe('/staff/:id streams the profile behind its shell', () => {
  it('answers an unknown worker with notFound() before anything streams', async () => {
    state.head = { profile: null, problem: null };
    await expect(Page(params(NOBODY))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  it('answers a malformed id with notFound() without reading anything', async () => {
    state.head = { profile: null, problem: 'invalid input syntax for type uuid' };
    await expect(Page(params('not-a-uuid'))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  it('a profile that cannot be read is a message, not a 404', async () => {
    state.head = { profile: null, problem: 'The profile could not be read.' };
    const html = renderToString(await Page(params(ID)));
    expect(html).toContain('The profile could not be read.');
  });

  it('starts the full profile with the head, and paints the name over a skeleton', async () => {
    state.head = { profile: PROFILE, problem: null };
    const html = renderToString(await Page(params(ID))).replace(/<!-- -->/g, '');
    // The profile's reads were started before the head was even asked.
    expect(state.startedBeforeHead).toBe(1);
    expect(html).toContain('<b>Amara Kalu</b> · THC-00873');
    expect(html).toContain('Loading the profile');
    expect(html).not.toContain('profile body');
    expect(state.shells).toBe(1);
  });

  it('streams the profile in, bare, inside the one shell', async () => {
    state.head = { profile: PROFILE, problem: null };
    state.full = async () => ({ profile: PROFILE, problem: null });
    const html = await settled(await Page(params(ID)));
    expect(html).toContain('profile body');
    expect(html).not.toContain('Loading the profile');
    expect(state.screen.at(-1)).toMatchObject({ bare: true, canMessage: true });
    expect(state.shells).toBe(1);
  });

  it('a profile that fails after the head is said inside the shell', async () => {
    state.head = { profile: PROFILE, problem: null };
    state.full = async () => ({ profile: null, problem: 'The documents could not be read.' });
    const html = await settled(await Page(params(ID)));
    expect(html).toContain('The documents could not be read.');
  });
});
