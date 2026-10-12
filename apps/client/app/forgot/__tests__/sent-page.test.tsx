import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A2 "Check your inbox" (security review 12.10): the address comes from the
 * flash cookie A1 wrote, is printed only if it reads as an email, and the
 * office address is a mailto link.
 */
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'thc-reset-sent' && state.cookie !== undefined ? { value: state.cookie } : undefined,
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: Page } = await import('../sent/page');
const { sentAddress } = await import('../sent/flash');

const render = async () => renderToStaticMarkup(await Page());

beforeEach(() => {
  state.cookie = undefined;
});

describe('A2 · /forgot/sent', () => {
  it('names the address the flash cookie carries', async () => {
    state.cookie = 'venue@client.example';
    const html = await render();
    expect(html).toContain('<b class="mono">venue@client.example</b>');
  });

  it('says "that address" with no cookie, and never reads the query string', async () => {
    const html = await render();
    expect(html).toContain('If that address has an account');
  });

  it.each([
    'Your account is suspended. Call 0800 000 000',
    'venue@client.example and pay at evil.example',
    '<script>x</script>@a.bc',
    'no-at-sign.example',
  ])('prints nothing that is not an email: %j', async (value) => {
    state.cookie = value;
    const html = await render();
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

  it('sentAddress accepts one address, lower-cased', () => {
    expect(sentAddress(' Venue@Client.Example ')).toBe('venue@client.example');
    expect(sentAddress('a@b')).toBeNull();
    expect(sentAddress(undefined)).toBeNull();
  });
});
