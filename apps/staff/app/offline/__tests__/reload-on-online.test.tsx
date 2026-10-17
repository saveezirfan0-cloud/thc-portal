// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ONLINE_RELOAD_SPREAD_MS, ReloadWhenOnline } from '../ReloadWhenOnline';

/**
 * Go-live audit H5: regaining signal no longer reloads every page (it
 * reloaded the shift screen mid-check-in); only the offline shell, which
 * holds nothing, reloads itself to fetch the page it stands in for.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('reloading when the signal returns', () => {
  it('is off app-wide in the Serwist config', () => {
    const config = readFileSync(join(APP, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/reloadOnOnline:\s*false/);
    expect(config).not.toMatch(/reloadOnOnline:\s*true/);
  });

  it('the offline shell reloads itself once, within a few seconds of coming back online', async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<ReloadWhenOnline reload={reload} random={() => 1} />));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(ONLINE_RELOAD_SPREAD_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(ONLINE_RELOAD_SPREAD_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
