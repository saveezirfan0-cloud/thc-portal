import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ModeSwitch } from '../components/ModeSwitch';
import { AppHeader } from '../components/Mobile';
import { AuthCard } from '../components/AuthCard';

/**
 * ADR-0007 says the appearance control is "just Light / Dark". It was true
 * of `/design-system` and of nothing else in the product: the switch was a
 * page-local component in apps/office. These pin the shape of the shared
 * one, and that the two pieces of chrome that carry it by construction —
 * the phone header and the sign-in card — still do.
 *
 * It is a control, not decoration, so the assertions are about the parts a
 * keyboard and a screen reader use: real buttons, an accessible name, and
 * state that is published rather than drawn.
 */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node).replace(/ d="[^"]+"/g, ' d="…"');

describe('the appearance switch', () => {
  it('is a labelled pair of buttons in the wide form', () => {
    const markup = html(<ModeSwitch />);
    expect(markup).toContain('aria-label="Appearance"');
    expect(markup).toContain('Light');
    expect(markup).toContain('Dark');
    // Two real buttons, so both are in the tab order and both take the cyan
    // focus ring base.css puts on :focus-visible.
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain('aria-pressed=');
  });

  it('is one named toggle button in the compact form', () => {
    const markup = html(<ModeSwitch compact />);
    expect(markup.match(/<button/g)).toHaveLength(1);
    // The glyph carries no accessible name of its own, so the button has to.
    expect(markup).toContain('aria-label="Dark appearance"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('mode-switch');
  });

  it('matches its snapshot in both forms', () => {
    expect(
      html(
        <div>
          <ModeSwitch small />
          <ModeSwitch compact />
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('the chrome that carries it', () => {
  it('is in the Staff App header, in the compact form', () => {
    // §10.1: this header is 390px wide. A labelled pair would push the title.
    const markup = html(<AppHeader title="Autumn Partners Dinner" sub="Waiting Staff" />);
    expect(markup).toContain('mode-switch');
    expect(markup).not.toContain('>Light<');
  });

  it('is on the sign-in card, so a dark device does not get a light login', () => {
    const markup = html(
      <AuthCard product="Back Office">
        <span />
      </AuthCard>,
    );
    expect(markup).toContain('aria-label="Appearance"');
  });

  it('is dropped from a public card whose wireframe draws none', () => {
    // apply.html and activate.html: a card that reaches someone with no
    // account yet has no app behind it to disagree with (ADR-0007).
    const none = html(
      <AuthCard product="Account activation" appearance="none">
        <span />
      </AuthCard>,
    );
    expect(none).not.toContain('aria-label="Appearance"');
    expect(none).not.toContain('class="appearance"');
    // `false` is the same request; `true` and `'corner'` are the default.
    const card = (appearance: boolean | 'corner' | 'none') =>
      html(
        <AuthCard product="x" appearance={appearance}>
          <span />
        </AuthCard>,
      ).includes('aria-label="Appearance"');
    expect(card(false)).toBe(false);
    expect(card('corner')).toBe(true);
    expect(card(true)).toBe(true);
  });
});
