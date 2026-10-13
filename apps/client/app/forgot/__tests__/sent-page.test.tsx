import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * A2 "Check your inbox" (security review 12.10): the address `?to=` carries
 * is printed only if it reads as one email (`shownEmail`,
 * packages/db/src/recovery.ts), and the office address is a mailto link.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: Page } = await import('../sent/page');

const render = async (to?: string) =>
  renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve(to === undefined ? {} : { to }) }),
  );

describe('A2 · /forgot/sent', () => {
  it('names the address the link carries', async () => {
    const html = await render('venue@client.example');
    expect(html).toContain('<b class="mono">venue@client.example</b>');
  });

  it('says "that address" with none', async () => {
    const html = await render();
    expect(html).toContain('If that address has an account');
  });

  it.each([
    'Your account is suspended. Call 0800 000 000',
    'venue@client.example and pay at evil.example',
    '<script>x</script>@a.bc',
    'no-at-sign.example',
  ])('prints nothing that is not an email: %j', async (value) => {
    const html = await render(value);
    expect(html).toContain('If that address has an account');
    expect(html).not.toContain('Call 0800');
    expect(html).not.toContain('evil.example');
  });

  it('the office address is a mailto link', async () => {
    const html = await render();
    expect(html).toContain(
      '<a href="mailto:admin@thehospitalitycompany.co.uk">admin@thehospitalitycompany.co.uk</a>',
    );
  });
});
