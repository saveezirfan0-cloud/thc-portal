// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIME_FORMAT_COOKIE } from '@thc/domain';

/**
 * /profile/preferences — Time format (ADR-0085).
 *
 *   - 24-hour is the default and says so; the example follows the choice;
 *   - Save changes calls the server action, then refreshes, and shows the
 *     outcome inline, success or failure;
 *   - the action refuses anything but "24h" / "12h" before the database,
 *     writes the profile through the worker's own RPC and the device cookie
 *     alongside it;
 *   - the form starts on the PROFILE's value, not the device's.
 */
const rpc = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const jar = vi.hoisted(() => ({
  set: vi.fn(),
  value: undefined as string | undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    get: (name: string) =>
      name === 'thc-time-format' && jar.value ? { value: jar.value } : undefined,
    set: jar.set,
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

const { saveTimeFormatPreference } = await import('../actions');
const { loadSavedTimeFormat } = await import('../data');
const { PreferencesForm } = await import('../PreferencesForm');

const saved = { ...process.env };
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  jar.value = undefined;
});

describe('saveTimeFormatPreference()', () => {
  it('writes the worker’s own profile and the device cookie, then refreshes every page', async () => {
    rpc.mockResolvedValue({ data: '12h', error: null });
    const result = await saveTimeFormatPreference('12h');
    expect(result).toEqual({ ok: true, note: 'Times now show on the 12-hour clock.' });
    // Only the format crosses: no id names whose profile (the RPC reads auth.uid()).
    expect(rpc).toHaveBeenCalledWith('set_my_time_format', { p_format: '12h' });
    expect(jar.set).toHaveBeenCalledWith(
      TIME_FORMAT_COOKIE,
      '12h',
      expect.objectContaining({ path: '/', sameSite: 'lax' }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it.each(['24-hour', '', 'ampm', '12H', 'DROP TABLE'])(
    'refuses %j before it reaches the database or the cookie',
    async (value) => {
      const result = await saveTimeFormatPreference(value);
      expect(result).toEqual({ ok: false, message: 'Choose 24-hour or 12-hour.' });
      expect(rpc).not.toHaveBeenCalled();
      expect(jar.set).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('says so when the database refuses, and leaves the cookie alone', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await saveTimeFormatPreference('12h');
    expect(result).toEqual({ ok: false, message: "That didn't save. Try again in a moment." });
    expect(jar.set).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('asks a signed-out worker to sign in again', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_signed_in' } });
    const result = await saveTimeFormatPreference('24h');
    expect(!result.ok && result.message).toBe('Your session has ended. Sign in again.');
  });

  it('with no project configured, saves nothing', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const result = await saveTimeFormatPreference('12h');
      expect(result.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    }
  });
});

describe('loadSavedTimeFormat()', () => {
  it('prefers the profile over this device’s cookie, so a new phone or a stale cookie is right', async () => {
    jar.value = '24h';
    rpc.mockResolvedValue({ data: '12h', error: null });
    expect(await loadSavedTimeFormat()).toEqual({ format: '12h', cookie: '24h' });
  });

  it('falls back to the cookie, then the default, when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    jar.value = '12h';
    expect(await loadSavedTimeFormat()).toEqual({ format: '12h', cookie: '12h' });
    jar.value = undefined;
    expect(await loadSavedTimeFormat()).toEqual({ format: '24h', cookie: null });
    rpc.mockRejectedValue(new Error('network'));
    expect(await loadSavedTimeFormat()).toEqual({ format: '24h', cookie: null });
  });
});

describe('<PreferencesForm>', () => {
  it('marks 24-hour as the default and shows its example', () => {
    const html = renderToStaticMarkup(<PreferencesForm saved="24h" />);
    expect(html).toContain('24-hour (default)');
    expect(html).toContain('12-hour');
    expect(html).toContain('e.g. 17:30');
    // Nothing to save until the choice changes.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes<\/button>/);
  });

  it('opens on the 12-hour clock for a worker who chose it', () => {
    const html = renderToStaticMarkup(<PreferencesForm saved="12h" />);
    expect(html).toContain('e.g. 5:30 pm');
    expect(html).toMatch(/aria-pressed="true"[^>]*>12-hour</);
  });

  describe('in the browser', () => {
    let root: Root | null = null;
    let host: HTMLDivElement | null = null;
    afterEach(() => {
      act(() => root?.unmount());
      host?.remove();
      root = null;
      host = null;
    });
    function mount(node: React.ReactNode) {
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      act(() => root!.render(node));
      return host;
    }
    const button = (name: string) =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === name)!;
    const flush = () => act(async () => void (await Promise.resolve()));

    it('previews the other clock live, then saves it, refreshes, and says so', async () => {
      rpc.mockResolvedValue({ data: '12h', error: null });
      const el = mount(<PreferencesForm saved="24h" />);
      expect(el.textContent).toContain('e.g. 17:30');

      act(() => button('12-hour').click());
      expect(el.textContent).toContain('e.g. 5:30 pm');
      expect(button('Save changes').disabled).toBe(false);
      // The preview is not a save.
      expect(rpc).not.toHaveBeenCalled();

      await act(async () => button('Save changes').click());
      await flush();
      expect(rpc).toHaveBeenCalledWith('set_my_time_format', { p_format: '12h' });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(el.textContent).toContain('Times now show on the 12-hour clock.');
      expect(button('Save changes').disabled).toBe(true);
    });

    it('shows the failure inline and does not refresh', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
      const el = mount(<PreferencesForm saved="24h" />);
      act(() => button('12-hour').click());
      await act(async () => button('Save changes').click());
      await flush();
      expect(el.textContent).toContain("That didn't save. Try again in a moment.");
      expect(el.textContent).not.toContain('Times now show');
      expect(refresh).not.toHaveBeenCalled();
      // Still unsaved, so still saveable.
      expect(button('Save changes').disabled).toBe(false);
    });
  });
});
