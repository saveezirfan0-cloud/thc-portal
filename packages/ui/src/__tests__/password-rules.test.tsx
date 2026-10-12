import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, checkPassword } from '@thc/domain';

import { PasswordRules } from '../components/PasswordRules';

/**
 * The password checklist (wireframes/public/activate.html:15-18). It was
 * copied into three Client Portal forms using the Staff App's `.mlist`
 * rows: a coral ✕ on every rule before anything was typed, and the marks
 * aria-hidden with nothing else, so a screen reader heard the rule and
 * never whether it was met.
 */
const items = (markup: string) =>
  [...markup.matchAll(/<li(?: class="(\w+)")?>(.*?)<\/li>/g)].map((m) => ({
    state: m[1] ?? 'pending',
    body: m[2]!,
  }));

describe('PasswordRules', () => {
  it('is neutral before anything is typed — no crosses, nothing red', () => {
    const markup = renderToStaticMarkup(<PasswordRules value="" confirm="" />);
    const rules = items(markup);
    expect(rules.map((r) => r.state)).toEqual(['pending', 'pending', 'pending']);
    expect(markup).not.toContain('✕');
    expect(markup).not.toContain('class="bad"');
    expect(markup.match(/○/g)).toHaveLength(3);
  });

  it('names the rules the server enforces, in its words', () => {
    const markup = renderToStaticMarkup(<PasswordRules value="" confirm="" />);
    expect(markup).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
    expect(markup).toContain('Contains a number');
    expect(markup).toContain('Both fields match');
  });

  it('ticks a rule green as soon as it is met, touched or not', () => {
    const rules = items(renderToStaticMarkup(<PasswordRules value="gala1" confirm="" />));
    expect(rules.map((r) => r.state)).toEqual(['pending', 'ok', 'pending']);
    expect(rules[1]!.body).toContain('✓');
  });

  it('turns an unmet rule coral only once the field has been left', () => {
    const rules = items(
      renderToStaticMarkup(<PasswordRules value="gala" confirm="" touched confirmTouched />),
    );
    expect(rules.map((r) => r.state)).toEqual(['bad', 'bad', 'bad']);
    expect(rules.every((r) => r.body.includes('✕'))).toBe(true);
  });

  it('judges "Both fields match" on the confirmation field’s own touch', () => {
    const rules = items(renderToStaticMarkup(<PasswordRules value="gala" confirm="" touched />));
    expect(rules.map((r) => r.state)).toEqual(['bad', 'bad', 'pending']);
  });

  it('agrees with checkPassword() on a password that passes', () => {
    const value = 'Gala-Dinner-2026';
    expect(checkPassword(value, value)).toEqual({ long: true, hasNumber: true, matches: true });
    const rules = items(renderToStaticMarkup(<PasswordRules value={value} confirm={value} />));
    expect(rules.map((r) => r.state)).toEqual(['ok', 'ok', 'ok']);
  });

  it('leaves "Both fields match" out when the form has one field', () => {
    const markup = renderToStaticMarkup(<PasswordRules value="" />);
    expect(items(markup)).toHaveLength(2);
    expect(markup).not.toContain('Both fields match');
  });

  it('speaks each rule’s state; the mark itself is decoration', () => {
    const markup = renderToStaticMarkup(
      <PasswordRules id="pw-rules" value="gala1" confirm="x" touched confirmTouched />,
    );
    expect(markup).toMatch(/^<ul class="rules" id="pw-rules" aria-label="Password rules">/);
    for (const mark of ['✓', '✕']) {
      expect(markup).toContain(`<span class="mark" aria-hidden="true">${mark}</span>`);
    }
    expect(markup).toContain('Contains a number<span class="state">, met</span>');
    expect(markup).toContain(
      `At least ${PASSWORD_MIN_LENGTH} characters<span class="state">, not met</span>`,
    );
    const untouched = renderToStaticMarkup(<PasswordRules value="" />);
    expect(untouched).toContain('<span class="state">, not met yet</span>');
  });

  it('is drawn by the auth sheet: muted, green ink, coral ink, hidden state text', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'auth.css'),
      'utf8',
    );
    expect(css).toMatch(/\.rules \{[^}]*color: var\(--muted\)/);
    expect(css).toMatch(/\.rules li\.ok \{\s*color: var\(--green-ink\)/);
    expect(css).toMatch(/\.rules li\.bad \{\s*color: var\(--coral-ink\)/);
    expect(css).toMatch(/\.rules \.state \{[^}]*clip-path: inset\(50%\)/);
  });
});
