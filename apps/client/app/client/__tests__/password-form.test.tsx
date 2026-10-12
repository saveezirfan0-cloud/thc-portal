import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactModule from 'react';

/**
 * "Change password" on Your account (ADR-0051): the shared checklist, the
 * "Show" addon on both the current and the new password, and — the one that
 * was wrong — a change that went through but could NOT sign the other
 * devices out is amber (needs action), never the green of a clean success.
 */
const action = vi.hoisted(() => ({ state: null as unknown }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useActionState: () => [action.state, () => {}, false],
  };
});
vi.mock('../account/actions', () => ({ changePassword: vi.fn() }));

const { PasswordForm } = await import('../account/PasswordForm');
const { PASSWORD_COPY } = await import('../account/copy');

const render = () => renderToStaticMarkup(<PasswordForm />);

beforeEach(() => {
  action.state = null;
});

describe('the change-password form', () => {
  it('uses the shared rules, neutral at rest', () => {
    const markup = render();
    expect(markup).toContain('<ul class="rules"');
    expect(markup).not.toContain('✕');
    expect(markup).not.toContain('acct-check');
  });

  it('offers "Show" on the current and the new password, not on the confirmation', () => {
    const markup = render();
    expect(markup.match(/>Show<\/button>/g)).toHaveLength(2);
    expect(markup).toMatch(/name="current"[^>]*\/><button type="button" class="addon"/);
    expect(markup).toMatch(/name="password"[^>]*\/><button type="button" class="addon"/);
    expect(markup).not.toMatch(/name="confirm"[^>]*\/><button/);
  });

  it('confirms a clean change in green', () => {
    action.state = { ok: true, message: PASSWORD_COPY.changed, round: 1 };
    expect(render()).toContain(`<div class="toast green" role="status" aria-live="polite">`);
  });

  it('flags a change that left other devices signed in in amber', () => {
    action.state = { ok: true, message: PASSWORD_COPY.changedOthersKept, round: 1 };
    const markup = render();
    expect(markup).toContain(`<div class="toast amber" role="status" aria-live="polite">`);
    expect(markup).not.toContain('toast green');
  });

  it('takes the tone from the action when it names one', () => {
    action.state = { ok: true, message: 'Password changed.', round: 1, tone: 'warning' };
    expect(render()).toContain('toast amber');
  });

  it('keeps a refusal a coral alert', () => {
    action.state = { ok: false, message: PASSWORD_COPY.currentWrong, round: 0 };
    const markup = render();
    expect(markup).toContain('alert coral');
    expect(markup).not.toContain('toast');
  });
});
