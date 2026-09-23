import { describe, expect, it } from 'vitest';
import { installLink, issueActivationLink } from '../provision';
import type { AdminAuth, AuthUserLike } from '../provision';

/**
 * issueActivationLink — what the office Accept, the office Resend and
 * the Willo receiver all call (ADR-0021). provisionStaffLogin's own cases
 * are in apps/office/app/onboarding/__tests__/activation.test.ts.
 */
const TOKEN = 'e4'.repeat(28);
const USER: AuthUserLike = { id: 'u-1', email: 'mei@example.com', app_metadata: { role: 'staff' } };

function admin(calls: string[]): AdminAuth {
  return {
    async generateLink(params) {
      calls.push(`generateLink:${params.type}`);
      return { data: { user: USER, properties: { hashed_token: TOKEN } }, error: null };
    },
    async getUserById() {
      calls.push('getUserById');
      return { data: { user: USER }, error: null };
    },
    async updateUserById() {
      calls.push('updateUserById');
      return { error: null };
    },
  };
}

describe('issueActivationLink', () => {
  it('returns the personal link and the install link', async () => {
    const out = await issueActivationLink(
      admin([]),
      { email: 'mei@example.com', userId: null },
      'https://app.thc.example/',
    );
    expect(out).toEqual({
      ok: true,
      userId: 'u-1',
      link: `https://app.thc.example/activate/${TOKEN}`,
      installLink: 'https://app.thc.example/install',
      type: 'invite',
    });
  });

  it('a bad origin is refused BEFORE a token is minted — the link in the inbox survives', async () => {
    const calls: string[] = [];
    const out = await issueActivationLink(
      admin(calls),
      { email: 'mei@example.com', userId: 'u-1' },
      'app.thc.example',
    );
    expect(out).toEqual({ ok: false, code: 'activation_link_required' });
    expect(calls).toEqual([]);
  });

  it('install link', () => {
    expect(installLink(' https://x.example// ')).toBe('https://x.example/install');
  });
});
