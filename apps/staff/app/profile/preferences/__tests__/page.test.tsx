import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * /profile/preferences is reachable by the same workers as Security settings
 * (`canReachProfileDetails`) and no others: a hold, a leaver, a candidate in
 * the wizard and a worker locked to Documents are sent back to /profile,
 * which draws whatever their lock is — a typed URL lands where a tap would.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('../../../_lib/timeFormat', () => ({
  timeFormatChoice: async () => ({ format: '24h', remember: false }),
}));
vi.mock('../data', () => ({ loadSavedTimeFormat: async () => ({ format: '12h', cookie: '24h' }) }));
vi.mock('../../photos', () => ({ signOwnPhoto: async () => null }));

const state = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }));
vi.mock('../../data', () => ({
  supabaseConfigured: () => true,
  loadProfile: async () => state.profile,
}));

const { default: Page } = await import('../page');

const worker = (over: Record<string, unknown> = {}) => ({
  firstName: 'Tom',
  lastName: 'Reid',
  photoPath: null,
  status: 'compliant',
  blockKind: null,
  quizAttempts: 1,
  blockers: [],
  rejectionCause: null,
  ...over,
});

async function outcome(): Promise<string> {
  try {
    return renderToStaticMarkup((await Page()) as ReactElement);
  } catch (error) {
    return (error as Error).message;
  }
}

describe('/profile/preferences', () => {
  it('shows a working worker the form, on the profile’s value rather than the device’s', async () => {
    state.profile = worker();
    const html = await outcome();
    expect(html).toContain('Preferences');
    expect(html).toContain('Time format');
    expect(html).toContain('e.g. 5:30 pm');
    expect(html).toContain('24-hour (default)');
  });

  it('also opens for a worker locked to Documents, as Security settings does', async () => {
    state.profile = worker({ blockers: ['document_expired:passport'] });
    // Security's own gate is the same function: canReachProfileDetails().
    const html = await outcome();
    expect(html.startsWith('REDIRECT')).toBe(false);
  });

  it.each([
    ['a hold', worker({ status: 'blocked', blockKind: 'manual' })],
    ['a leaver', worker({ status: 'inactive' })],
    ['a removed worker', worker({ status: 'removed' })],
    ['a candidate in the wizard', worker({ status: 'documents' })],
  ])('sends %s back to /profile', async (_name, profile) => {
    state.profile = profile;
    expect(await outcome()).toBe('REDIRECT:/profile');
  });

  it('sends a signed-out visitor back to /profile', async () => {
    state.profile = null;
    expect(await outcome()).toBe('REDIRECT:/profile');
  });
});
