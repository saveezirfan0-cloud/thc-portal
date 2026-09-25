import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import OfflinePage from '../page';

/**
 * /offline (§10.5, ADR-0001) must tell the truth about a check-in pressed
 * with no signal. There is no queue: the service worker sends every write
 * NetworkOnly and registers no Background Sync, and the on-shift screen
 * awaits the action once. A worker told "your attempt is saved — don't
 * check in twice" who believes it hits the start+30 automatic No-show
 * (§9.5). The promise may come back only with the queue and a test that
 * proves the replay — which is what the guard below checks for.
 */
const STAFF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sw = readFileSync(join(STAFF, 'sw.ts'), 'utf8');
const shiftScreen = readFileSync(join(STAFF, 'app', 'shifts', '[id]', 'ShiftScreen.tsx'), 'utf8');

/** Strip comments so prose about a queue does not count as one. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const hasQueue =
  /addEventListener\(\s*['"]sync['"]/.test(code(sw)) ||
  /BackgroundSync/.test(code(sw)) ||
  /sync\.register\(/.test(code(shiftScreen)) ||
  /indexedDB|localStorage/.test(code(shiftScreen));

const PROMISE = /saved on this phone|check in twice|sent the moment/i;

describe('/offline and the check-in that did not go through', () => {
  const html = renderToStaticMarkup(<OfflinePage />);

  it('still says what the shell is for', () => {
    expect(html).toContain('You’re offline');
    expect(html).toContain('pull down to refresh');
  });

  it('tells the worker the attempt failed and to check in again with signal', () => {
    expect(html).toContain('If you were checking in, it did not go through.');
    expect(html).toContain('Check in again as soon as you have signal.');
  });

  it('never promises a queued replay the app does not have', () => {
    // If this fails because the queue has now been built, replace the
    // guard with a test that proves the replay before restoring the copy.
    expect(hasQueue).toBe(false);
    expect(html).not.toMatch(PROMISE);
  });
});
