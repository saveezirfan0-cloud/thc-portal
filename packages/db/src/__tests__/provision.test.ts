import { describe, expect, it } from 'vitest';
import { installLink, isBanned, issueActivationLink, provisionStaffLogin } from '../provision';
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

/**
 * D9b · a GDPR-removed worker who re-applies with the same address.
 *
 * A tiny GoTrue: users by address, `invite` creates one unless the
 * address is taken by a confirmed login, `magiclink` finds the holder.
 * remove_worker() (20260929140100) bans the old login AND replaces its
 * address with removed-<id>@invalid.example; 630 asserts the SQL half.
 */
function gotrue(users: AuthUserLike[]): AdminAuth & { created: string[] } {
  const created: string[] = [];
  const byEmail = (email: string) => users.find((u) => u.email === email) ?? null;
  return {
    created,
    async generateLink({ type, email }) {
      const holder = byEmail(email);
      if (type === 'invite') {
        if (holder?.email_confirmed_at) {
          return { data: null, error: { message: 'already registered', code: 'email_exists' } };
        }
        const user = holder ?? { id: `new-${users.length + 1}`, email, app_metadata: {} };
        if (!holder) {
          users.push(user);
          created.push(user.id);
        }
        return { data: { user, properties: { hashed_token: TOKEN } }, error: null };
      }
      if (!holder) return { data: null, error: { message: 'User not found' } };
      return { data: { user: holder, properties: { hashed_token: TOKEN } }, error: null };
    },
    async getUserById(id) {
      return { data: { user: users.find((u) => u.id === id) ?? null }, error: null };
    },
    async updateUserById() {
      return { error: null };
    },
  };
}

const CENTURY = '2126-09-25T12:00:00Z';

describe('a removed worker re-applying (§1.7, D9b)', () => {
  it('after the scrub, the same address gets a NEW login, never the banned one', async () => {
    const removed: AuthUserLike = {
      id: 'old-login',
      email: 'removed-d63000000000400080000000000000@invalid.example',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { role: 'staff' },
      banned_until: CENTURY,
    };
    const auth = gotrue([removed]);
    const out = await provisionStaffLogin(auth, { email: 'grace.l@example.com', userId: null });
    expect(out).toMatchObject({ ok: true, type: 'invite' });
    expect(out.ok && out.userId).not.toBe('old-login');
    expect(auth.created).toHaveLength(1);
  });

  it('a banned login still holding the address is never handed a link', async () => {
    const unscrubbed: AuthUserLike = {
      id: 'old-login',
      email: 'grace.l@example.com',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { role: 'staff' },
      banned_until: CENTURY,
    };
    const out = await provisionStaffLogin(gotrue([unscrubbed]), {
      email: 'grace.l@example.com',
      userId: null,
    });
    expect(out).toEqual({ ok: false, code: 'account_link_failed', detail: 'login_disabled' });
  });

  it('isBanned reads a future ban only', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(isBanned({ id: 'a', banned_until: CENTURY }, now)).toBe(true);
    expect(isBanned({ id: 'a', banned_until: '2026-09-24T00:00:00Z' }, now)).toBe(false);
    expect(isBanned({ id: 'a', banned_until: null }, now)).toBe(false);
    expect(isBanned({ id: 'a' }, now)).toBe(false);
  });
});
