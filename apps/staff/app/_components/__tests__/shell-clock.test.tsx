import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TimeFormat } from '@thc/domain';

/**
 * ADR-0085: `StaffShell` is where every working screen picks up the worker's
 * clock. It reads the choice once (a cookie, else the profile) and hands it to
 * `TimeFormatProvider`, so the client components below — `ShiftTime`,
 * `UkTime`, the Availability fields — write times on it from the first paint.
 * The read is the shell's, not the root layout's: a static page such as
 * /offline must stay static for the PWA.
 */
const choice = vi.hoisted(() => ({ value: { format: '24h', remember: false } }));
vi.mock('../../_lib/timeFormat', () => ({ timeFormatChoice: async () => choice.value }));
vi.mock('../useViewerZone', () => ({ useViewerZone: () => 'Europe/London' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { StaffShell } = await import('../StaffShell');
const { ShiftTime } = await import('../ShiftTime');

const start = new Date('2026-09-19T16:00:00Z'); // 17:00 UK
const end = new Date('2026-09-19T22:30:00Z'); // 23:30 UK

async function render(format: TimeFormat): Promise<string> {
  choice.value = { format, remember: false };
  const element = await StaffShell({
    title: 'Shifts',
    active: '/shifts',
    children: <ShiftTime startsAt={start} endsAt={end} />,
  });
  return renderToStaticMarkup(element);
}

describe('StaffShell and the worker’s clock', () => {
  it('is 24-hour by default', async () => {
    const html = await render('24h');
    expect(html).toContain('17:00 – 23:30');
  });

  it('puts a 12-hour worker’s screens on their clock', async () => {
    const html = await render('12h');
    expect(html).toContain('5:00 pm – 11:30 pm');
    expect(html).not.toContain('17:00');
  });

  it('does not touch the root layout, so static pages stay static', async () => {
    const { readFileSync } = await import('node:fs');
    const layout = readFileSync(new URL('../../layout.tsx', import.meta.url), 'utf8');
    expect(layout).not.toMatch(/cookies\(|timeFormat|readTimeFormat/);
  });
});
