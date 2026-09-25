import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The check-out outcomes as whole screens, `wireframes/staff/shift-detail.html`
 * (i) and (j) — not one-line banners on a screen still offering Check out.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { NoOnSiteFixScreen, OffSiteCheckOutScreen } = await import('../FullScreens');

describe('(i) check-out pressed off site', () => {
  it('says the recorded time, lays out the three stamps, and continues to the summary', () => {
    const html = renderToStaticMarkup(
      <OffSiteCheckOutScreen
        head={<div>head</div>}
        distanceM={9600}
        checkedIn="07:51"
        paidFrom="08:00 (UK)"
        lastOnSite="16:00"
        pressedAt="21:04"
        onContinue={() => {}}
      />,
    );
    expect(html).toContain(
      'You checked out away from the venue — we’ve recorded your last time on site, 16:00.',
    );
    expect(html).toContain('You’re 9.6 km from the venue');
    expect(html).toContain('07:51 · paid from 08:00 (UK)');
    expect(html).toContain('16:00 (GPS)');
    expect(html).toContain('21:04 · not used');
    expect(html).toContain('Continue to summary');
    expect(html).not.toContain('Check out<');
  });
});

describe('(j) off site with no on-site fix — RULE-02', () => {
  it('says the office will confirm the finish, and asks only for "OK, I understand"', () => {
    const html = renderToStaticMarkup(
      <NoOnSiteFixScreen head={null} distanceM={9600} checkedIn="07:51" onOk={() => {}} />,
    );
    expect(html).toContain(
      'We couldn’t confirm when you left the venue — the office will confirm your finish time with you.',
    );
    expect(html).toContain('Your check-in at 07:51 was recorded on site');
    expect(html).toContain('OK, I understand');
  });
});
