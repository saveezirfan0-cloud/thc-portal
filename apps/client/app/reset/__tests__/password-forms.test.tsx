import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PASSWORD_MIN_LENGTH } from '@thc/domain';

/**
 * The two public "choose a password" forms — A3 /reset and the invitation
 * (wireframes/public/activate.html). Both used to carry their own copy of
 * the Staff App's `.mlist` checklist: a coral ✕ against every rule before
 * a key was pressed, and marks hidden from screen readers with nothing in
 * their place. They now share `PasswordRules` from @thc/ui, and the new
 * password gets the same "Show" addon the sign-in field has.
 */
vi.mock('../actions', () => ({ setPassword: vi.fn() }));
vi.mock('../../auth/invite/actions', () => ({ acceptInvite: vi.fn() }));

const { ResetForm } = await import('../ResetForm');
const { InviteForm } = await import('../../auth/invite/InviteForm');

const forms = [
  ['/reset', () => renderToStaticMarkup(<ResetForm />)],
  ['/auth/invite', () => renderToStaticMarkup(<InviteForm token="t" type="invite" />)],
] as const;

describe.each(forms)('%s password form', (_name, render) => {
  const markup = render();

  it('lays out with the shared auth-form class, no inline layout', () => {
    expect(markup).toMatch(/^<form[^>]*class="auth-form"/);
    expect(markup).not.toMatch(/<form[^>]*style=/);
    expect(markup).not.toContain('padding:6px 0');
  });

  it('shows the rules neutral at rest — no crosses before anything is typed', () => {
    expect(markup).toContain('<ul class="rules"');
    expect(markup).not.toContain('class="mlist"');
    expect(markup).not.toContain('✕');
    expect(markup.match(/○/g)).toHaveLength(3);
    expect(markup).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
    expect(markup).toContain('Contains a number');
    expect(markup).toContain('Both fields match');
  });

  it('describes the new password by the rules list', () => {
    const list = /<ul class="rules" id="([^"]+)"/.exec(markup);
    expect(list).not.toBeNull();
    expect(markup).toMatch(
      new RegExp(
        `<input type="password" id="[^"]+" class="input"[^>]*aria-describedby="${list![1]}"[^>]*name="password"`,
      ),
    );
  });

  it('welds a "Show" toggle to the new password, and only to it', () => {
    expect(markup).toMatch(
      /<div class="input-row"><input type="password"[^>]*name="password"[^>]*\/><button type="button" class="addon"[^>]*aria-pressed="false"[^>]*>Show<\/button><\/div>/,
    );
    expect(markup.match(/>Show<\/button>/g)).toHaveLength(1);
  });
});
