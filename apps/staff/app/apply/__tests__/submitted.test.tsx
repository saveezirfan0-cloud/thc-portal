import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'sam@example.com' }) }),
}));
vi.mock('@thc/ui', () => ({ Logo: () => null }));

const { default: Page } = await import('../submitted/page');

const render = async (from?: string) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(from ? { from } : {}) }));

/**
 * "Check your inbox" (§2.7). SpudBros Express staff skip the Willo interview
 * (ADR-0117), so after /apply/spudbros the next email is THC's set-up email,
 * and the page must not send them looking for a Willo one.
 */
describe('/apply/submitted', () => {
  it('tells an ordinary applicant to look for Willo', async () => {
    const html = await render();
    expect(html).toContain('link to your video interview');
    expect(html).toContain('notification@willotalent.com');
  });

  it('tells a SpudBros applicant to look for THC’s set-up email, not Willo', async () => {
    const html = await render('spudbros');
    expect(html).toContain('Activate your account');
    expect(html).toContain('no video interview for SpudBros Express staff');
    expect(html).not.toContain('willotalent');
    expect(html).not.toContain('Willo (interview invitation)');
    expect(html).toContain('sam@example.com');
  });

  it('ignores any other value', async () => {
    expect(await render('admin')).toContain('notification@willotalent.com');
  });
});
