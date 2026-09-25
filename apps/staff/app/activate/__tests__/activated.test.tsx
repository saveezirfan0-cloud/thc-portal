import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * "Activated · install the app" — wireframes/public/activate.html, §2.7.
 * Effects do not run under renderToStaticMarkup, so each platform is opened
 * through `initialPlatform`, as /install's tests do.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://app.thehospitalitycompany.co.uk';
const { ActivatedScreen, AppQr } = await import('../done/ActivatedScreen');

describe('/activate/done', () => {
  it('desktop: the QR of the app’s public address, beside the address itself', () => {
    const html = renderToStaticMarkup(<ActivatedScreen initialPlatform="desktop" />);
    expect(html).toContain('Scan with your phone camera, or open');
    expect(html).toContain('href="https://app.thehospitalitycompany.co.uk"');
    expect(html).toContain('>app.thehospitalitycompany.co.uk<');
    expect(html).toContain('class="act-qr"');
    expect(html).toContain('aria-label="QR code → https://app.thehospitalitycompany.co.uk"');
    // Both platforms' steps, to follow on the phone.
    expect(html).toContain('iPhone · Safari');
    expect(html).toContain('Android · Chrome');
    expect(html).toContain('href="/onboarding" class="btn primary block lg"');
  });

  it('phone: no QR — the candidate is already on the phone', () => {
    for (const platform of ['ios', 'android', 'installed'] as const) {
      const html = renderToStaticMarkup(<ActivatedScreen initialPlatform={platform} />);
      expect(html).not.toContain('act-qr');
      expect(html).not.toContain('Scan with your phone camera');
    }
  });

  it('draws the QR as one crisp path in the box’s own colours', () => {
    const html = renderToStaticMarkup(<AppQr url="https://app.thehospitalitycompany.co.uk" />);
    expect(html).toMatch(/<svg viewBox="0 0 (\d+) \1" shape-rendering="crispEdges" role="img"/);
    expect(html).toContain('fill="currentColor"');
    // A finder pattern's 7-module top edge is the first thing on the path.
    expect(html).toContain('d="M0 0h1v1H0zM1 0h1v1H1zM2 0h1v1H2zM3 0h1v1H3z');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
