// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit M4: a tab older than the deploy asks for a chunk that is
 * gone, and the screen falls to the error boundary. The boundary hands the
 * error to the once-a-minute reload (app/_lib/stale-deploy.ts), and logs
 * nothing when it reloads. Any other error is logged as before.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
const reloadForStaleChunk = vi.hoisted(() => vi.fn((_error: unknown) => false));
vi.mock('../_lib/stale-deploy', () => ({ reloadForStaleChunk }));

const { default: RouteError } = await import('../error');

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

afterEach(() => {
  reloadForStaleChunk.mockReset();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function mount(error: Error) {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<RouteError error={error} reset={() => {}} />));
  return root;
}

describe('the error boundary and a missing chunk', () => {
  it('asks for the reload with the error it caught, and logs nothing when it reloads', async () => {
    reloadForStaleChunk.mockReturnValue(true);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('Loading chunk 8269 failed.'), {
      name: 'ChunkLoadError',
    });
    const root = await mount(error);
    expect(reloadForStaleChunk).toHaveBeenCalledWith(error);
    expect(log).not.toHaveBeenCalledWith('[staff] unhandled error', expect.anything());
    await act(async () => root.unmount());
  });

  it('still shows the screen and logs the digest when it does not reload', async () => {
    reloadForStaleChunk.mockReturnValue(false);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await mount(Object.assign(new Error('boom'), { digest: 'd1' }));
    expect(document.body.textContent).toContain('We couldn’t load this screen');
    expect(log).toHaveBeenCalledWith('[staff] unhandled error', { digest: 'd1' });
    await act(async () => root.unmount());
  });
});
