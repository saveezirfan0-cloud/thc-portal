import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * `/apply?ref=` as the applicant sees it (ADR-0040,
 * `wireframes/staff/refer.html` "/apply?ref=K7M4Q2XP"): the form exactly
 * as `/apply`, with the code in a hidden field — and nothing about the
 * referrer. The consent line and `/privacy` say referrals are recorded.
 */
vi.mock('../actions', () => ({ apply: async () => ({ errors: {}, values: {} }) }));

const { default: ApplyPage } = await import('../page');
const { default: PrivacyPage } = await import('../../privacy/page');
const { referralCodeFrom } = await import('../form');

const SENTENCE = 'If a friend referred you, we record who referred you.';

async function render(ref?: string | string[]): Promise<string> {
  const page = await ApplyPage({ searchParams: Promise.resolve(ref === undefined ? {} : { ref }) });
  return renderToStaticMarkup(page);
}

/** Everything but the hidden field, so "identical" means identical. */
function visible(html: string): string {
  return html.replace(/<input type="hidden" name="ref" value="[^"]*"\/>/, '');
}

describe('/apply?ref= — the hidden field', () => {
  it('carries a valid code, normalised, in a hidden field named ref', async () => {
    const html = await render('k7m4q2xp');
    expect(html).toContain('<input type="hidden" name="ref" value="K7M4Q2XP"/>');
  });

  it('draws no hidden field without a code, or for one that is not a code', async () => {
    for (const ref of [undefined, '', 'IO01ABCD', 'K7M4Q2X', '"><script>']) {
      expect(await render(ref)).not.toContain('name="ref"');
    }
  });

  it('takes the first of a repeated ?ref=', async () => {
    expect(await render(['K7M4Q2XP', 'R3VW8NTB'])).toContain('value="K7M4Q2XP"');
  });

  it('renders the same visible page with or without a code — nothing about the referrer', async () => {
    const referred = await render('K7M4Q2XP');
    const plain = await render();
    expect(visible(referred)).toBe(plain);
    expect(referred).not.toMatch(/referred by/i);
  });

  it('works when Next passes no searchParams at all', async () => {
    const html = renderToStaticMarkup(await ApplyPage({}));
    expect(html).not.toContain('name="ref"');
  });
});

describe('the consent line and /privacy say referrals are recorded (Q20)', () => {
  it('is in the consent line for every applicant, referred or not', async () => {
    expect(await render()).toContain(SENTENCE);
    expect(await render('K7M4Q2XP')).toContain(SENTENCE);
  });

  it('is in the privacy notice', () => {
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain(SENTENCE);
  });
});

describe('referralCodeFrom()', () => {
  it('trims and upper-cases a code', () => {
    expect(referralCodeFrom(' k7m4q2xp ')).toBe('K7M4Q2XP');
  });
  it('drops anything that is not a code, without an error', () => {
    for (const value of [null, undefined, 42, {}, '', 'IO01ABCD', 'K7M4Q2X', 'K7M4Q2XPP']) {
      expect(referralCodeFrom(value)).toBeNull();
    }
  });
  it('reads the first of an array, as Next hands a repeated parameter', () => {
    expect(referralCodeFrom(['R3VW8NTB', 'K7M4Q2XP'])).toBe('R3VW8NTB');
    expect(referralCodeFrom([])).toBeNull();
  });
});
