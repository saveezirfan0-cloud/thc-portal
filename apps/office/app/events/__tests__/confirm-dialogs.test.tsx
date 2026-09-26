import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The event board asks its questions in the design system's Modal, never in
 * `window.confirm` (wireframes/backoffice/event-board.html). The payroll
 * warnings (BookingActions) moved first; Accept application
 * (ApplicationActions) was the one left behind, and is pinned here.
 */
vi.mock('../[id]/actions', () => ({ acceptApplication: vi.fn() }));

const EVENTS = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('no browser confirm on /events (wireframe, §3.3)', () => {
  it('no screen under /events calls window.confirm', () => {
    const offenders = sources(EVENTS).filter((file) =>
      /window\.confirm\s*\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('Accept application shows its button and no dialog until pressed', async () => {
    const { ApplicationActions } = await import('../[id]/_components/ApplicationActions');
    const html = renderToStaticMarkup(
      <ApplicationActions eventId="evt-1" bookingId="bk-1" name="Ada Lovelace" />,
    );
    expect(html).toContain('Accept application');
    expect(html).not.toContain('role="dialog"');
  });
});
