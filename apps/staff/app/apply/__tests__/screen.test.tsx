import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * /apply and /apply/submitted against `wireframes/public/apply.html`, every
 * state, and the stylesheet against the token rule (docs/07: "components
 * never hard-code a colour or radius").
 *
 * The server action is stubbed: it holds the service-role client, which
 * refuses to load outside a server graph, and nothing here submits.
 */
vi.mock('../actions', () => ({
  apply: async () => ({ errors: {}, values: {} }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'amara.kalu@example.com' }) }),
}));

const { default: ApplyPage } = await import('../page');
const { default: SubmittedPage } = await import('../submitted/page');

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, '..', 'apply.css'), 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the two public screens are one card (wireframe apply.html, ADR-0007)', () => {
  const form = renderToStaticMarkup(<ApplyPage />);

  it('the form sits in the public card and draws no appearance switch', () => {
    expect(form).toContain('class="auth-card"');
    expect(form).toContain('Apply to work with us');
    expect(form).not.toContain('mode-switch');
    expect(form).not.toContain('class="appearance"');
  });

  it('“Check your inbox” is the same card, in its done state, with no switch either', async () => {
    const done = renderToStaticMarkup(await SubmittedPage());
    expect(done).toContain('class="auth-card done"');
    expect(done).toContain('Check your inbox');
    expect(done).toContain('amara.kalu@example.com');
    expect(done).not.toContain('mode-switch');
    expect(done).not.toContain('class="appearance"');
  });

  it('the picker is the wireframe’s caret wrapper around an ISO-valued select in two groups', () => {
    expect(form).toContain('class="caret apply-dial"');
    expect(form).toMatch(/<select class="input" name="country" aria-label="Country code"/);
    expect(form).toContain('<optgroup label="Common">');
    expect(form).toContain('<optgroup label="All countries">');
    // UK first, dialling code first (ADR-0009), and Finland is now in the list.
    expect(form).toMatch(/<optgroup label="Common"><option value="GB"[^>]*>\+44 🇬🇧 United Kingdom/);
    expect(form).toContain('+358 🇫🇮 Finland');
    // Never the old data-URI caret and never the old dialling-code field.
    expect(form).not.toContain('name="dialCode"');
  });
});

describe('apply.css reads tokens only (docs/07, ADR-0007)', () => {
  it('draws the select caret from the muted token, not a colour inside a data URL', () => {
    expect(rules).not.toMatch(/url\(\s*["']?data:/);
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b|%23[0-9a-fA-F]{3,8}\b|\brgba?\(/);
    expect(rules).toMatch(
      /\.apply-page \.caret::after\s*\{[^}]*content:\s*'▾'[^}]*color:\s*var\(--muted\)/,
    );
  });

  it('names no literal font size or radius for the picker', () => {
    const dial = /\.apply-page \.apply-dial select\.input\s*\{([^}]*)\}/.exec(rules)?.[1] ?? '';
    expect(dial).toMatch(/font-size:\s*var\(--fs-12\)/);
    expect(dial).not.toMatch(/\d+px/);
  });
});

describe('the phone frame (wireframe apply.html · Phone · 390px)', () => {
  const phone = /@media \(max-width: 480px\)\s*\{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? '';

  it('collapses the name row and makes the submit button sticky-bottom', () => {
    expect(phone).toMatch(/\.apply-page \.grid\.c2\s*\{[^}]*grid-template-columns:\s*1fr/);
    const button = /\.apply-page form > \.btn\.lg\s*\{([^}]*)\}/.exec(phone)?.[1] ?? '';
    expect(button).toMatch(/position:\s*sticky/);
    expect(button).toMatch(
      /bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ var\(--sp-12\)\)/,
    );
    expect(button).toMatch(/box-shadow:[^;]*var\(--panel\)/);
  });

  it('the card wrapper clips rather than hides, so the sticky button has the page to stick to', () => {
    // `overflow: hidden` on an ancestor makes it the scroll container a
    // sticky descendant sticks to, and `.auth-wrap` does not scroll — the
    // page does. `clip` clips the glows the same and creates no container.
    expect(rules).toMatch(/\.apply-page \.auth-wrap\s*\{[^}]*overflow:\s*clip/);
  });
});
