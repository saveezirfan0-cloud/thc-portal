import { describe, expect, it } from 'vitest';
import {
  acceptWithAccount,
  isEmailTaken,
  provisionStaffLogin,
  resendActivation,
} from '../activation';
import type { AcceptInput, AcceptRpc, AdminAuth, AuthUserLike, ResendRpc } from '../activation';

/**
 * Accept with the candidate's login (§2.4, §2.7, E3) — the order of the
 * GoTrue calls and the database call, and every way out of it. The admin
 * client is a fake that records what it was asked; nothing here talks to
 * Supabase.
 */
const TOKEN = 'c0'.repeat(28);
const OTHER_TOKEN = 'd1'.repeat(28);

interface Call {
  fn: string;
  args: unknown;
}

function fakeAdmin(
  script: {
    invite?: Awaited<ReturnType<AdminAuth['generateLink']>>;
    magiclink?: Awaited<ReturnType<AdminAuth['generateLink']>>;
    getUser?: Awaited<ReturnType<AdminAuth['getUserById']>>;
    update?: Awaited<ReturnType<AdminAuth['updateUserById']>>;
  },
  calls: Call[],
): AdminAuth {
  return {
    async generateLink(params) {
      calls.push({ fn: `generateLink:${params.type}`, args: params });
      const answer = params.type === 'invite' ? script.invite : script.magiclink;
      return answer ?? { data: null, error: { message: 'unscripted' } };
    },
    async getUserById(id) {
      calls.push({ fn: 'getUserById', args: id });
      return script.getUser ?? { data: null, error: { message: 'unscripted' } };
    },
    async updateUserById(id, attributes) {
      calls.push({ fn: 'updateUserById', args: { id, attributes } });
      return script.update ?? { error: null };
    },
  };
}

function fakeRpc(calls: Call[], error: string | null = null): AcceptRpc {
  return {
    async rpc(fn, args) {
      calls.push({ fn, args });
      return { error: error ? { message: error } : null };
    },
  };
}

function link(user: AuthUserLike, token = TOKEN) {
  return { data: { user, properties: { hashed_token: token } }, error: null };
}

const NEW_USER: AuthUserLike = { id: 'u-new', email: 'mei@example.com', app_metadata: {} };
const STAFF_USER: AuthUserLike = {
  id: 'u-staff',
  email: 'mei@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { role: 'staff' },
};
const ADMIN_USER: AuthUserLike = {
  id: 'u-admin',
  email: 'mei@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { role: 'admin' },
};
const TAKEN = {
  data: null,
  error: {
    message: 'A user with this email address has already been registered',
    status: 422,
    code: 'email_exists',
  },
};

const INPUT: AcceptInput = {
  staffId: 'staff-1',
  email: 'mei@example.com',
  linkedUserId: null,
  roleIds: ['role-1'],
  note: null,
  staffOrigin: 'https://app.thc.example',
};

describe('provisioning the login (step 1)', () => {
  it('a new candidate: invite, then app_metadata.role = staff', async () => {
    const calls: Call[] = [];
    const out = await provisionStaffLogin(fakeAdmin({ invite: link(NEW_USER) }, calls), {
      email: 'mei@example.com',
      userId: null,
    });
    expect(out).toEqual({ ok: true, userId: 'u-new', tokenHash: TOKEN, type: 'invite' });
    expect(calls.map((c) => c.fn)).toEqual(['generateLink:invite', 'updateUserById']);
    expect(calls[1]!.args).toEqual({
      id: 'u-new',
      attributes: { app_metadata: { role: 'staff' } },
    });
  });

  it('an address that is already a confirmed staff login: a magic link, role left alone', async () => {
    const calls: Call[] = [];
    const out = await provisionStaffLogin(
      fakeAdmin({ invite: TAKEN, magiclink: link(STAFF_USER, OTHER_TOKEN) }, calls),
      { email: 'mei@example.com', userId: null },
    );
    expect(out).toEqual({ ok: true, userId: 'u-staff', tokenHash: OTHER_TOKEN, type: 'magiclink' });
    expect(calls.map((c) => c.fn)).toEqual(['generateLink:invite', 'generateLink:magiclink']);
  });

  it('never turns an office or client login into a worker’s', async () => {
    const calls: Call[] = [];
    const out = await provisionStaffLogin(
      fakeAdmin({ invite: TAKEN, magiclink: link(ADMIN_USER) }, calls),
      { email: 'mei@example.com', userId: null },
    );
    expect(out).toEqual({ ok: false, code: 'account_not_staff' });
    expect(calls.some((c) => c.fn === 'updateUserById')).toBe(false);
  });

  it('an already linked login is reused, never replaced', async () => {
    const calls: Call[] = [];
    const out = await provisionStaffLogin(
      fakeAdmin(
        { getUser: { data: { user: STAFF_USER }, error: null }, magiclink: link(STAFF_USER) },
        calls,
      ),
      { email: 'mei@example.com', userId: 'u-staff' },
    );
    expect(out).toMatchObject({ ok: true, userId: 'u-staff', type: 'magiclink' });
    expect(calls.map((c) => c.fn)).toEqual(['getUserById', 'generateLink:magiclink']);
  });

  it('a linked login that has gone is reported, not recreated', async () => {
    const calls: Call[] = [];
    const out = await provisionStaffLogin(
      fakeAdmin({ getUser: { data: { user: null }, error: { message: 'User not found' } } }, calls),
      { email: 'mei@example.com', userId: 'u-gone' },
    );
    expect(out).toEqual({ ok: false, code: 'account_missing' });
    expect(calls.map((c) => c.fn)).toEqual(['getUserById']);
  });

  it('a GoTrue failure or a missing token is a failure, not an empty link', async () => {
    const down = await provisionStaffLogin(
      fakeAdmin({ invite: { data: null, error: { message: 'boom', status: 500 } } }, []),
      { email: 'mei@example.com', userId: null },
    );
    expect(down).toMatchObject({ ok: false, code: 'account_link_failed' });

    const noToken = await provisionStaffLogin(
      fakeAdmin(
        { invite: { data: { user: NEW_USER, properties: { hashed_token: '' } }, error: null } },
        [],
      ),
      { email: 'mei@example.com', userId: null },
    );
    expect(noToken).toMatchObject({ ok: false, code: 'account_link_failed' });
  });

  it('a role that could not be written stops before the database', async () => {
    const out = await provisionStaffLogin(
      fakeAdmin({ invite: link(NEW_USER), update: { error: { message: 'nope' } } }, []),
      { email: 'mei@example.com', userId: null },
    );
    expect(out).toMatchObject({ ok: false, code: 'account_role_failed' });
  });

  it('recognises GoTrue’s "already registered" in each of its shapes', () => {
    expect(isEmailTaken({ message: 'x', code: 'email_exists' })).toBe(true);
    expect(
      isEmailTaken({ message: 'A user with this email address has already been registered' }),
    ).toBe(true);
    expect(isEmailTaken({ message: 'Database error saving new user' })).toBe(false);
  });
});

describe('Accept (steps 1 and 2)', () => {
  it('hands the login and the personal link to ONE database call', async () => {
    const calls: Call[] = [];
    const out = await acceptWithAccount(
      { admin: fakeAdmin({ invite: link(NEW_USER) }, calls), rpc: fakeRpc(calls) },
      { ...INPUT, note: 'strong English' },
    );
    expect(out).toEqual({ ok: true, userId: 'u-new' });
    const rpc = calls.at(-1)!;
    expect(rpc.fn).toBe('onboarding_accept_with_account');
    expect(rpc.args).toEqual({
      p_staff: 'staff-1',
      p_roles: ['role-1'],
      p_note: 'strong English',
      p_user: 'u-new',
      p_activation_link: `https://app.thc.example/activate/${TOKEN}`,
      p_install_link: 'https://app.thc.example/install',
    });
  });

  it('a magic-link login carries its type on the link', async () => {
    const calls: Call[] = [];
    await acceptWithAccount(
      {
        admin: fakeAdmin({ invite: TAKEN, magiclink: link(STAFF_USER) }, calls),
        rpc: fakeRpc(calls),
      },
      INPUT,
    );
    expect((calls.at(-1)!.args as { p_activation_link: string }).p_activation_link).toBe(
      `https://app.thc.example/activate/${TOKEN}?type=magiclink`,
    );
  });

  it('when the login cannot be made, the database is never asked — so no E3', async () => {
    const calls: Call[] = [];
    const out = await acceptWithAccount(
      {
        admin: fakeAdmin({ invite: TAKEN, magiclink: link(ADMIN_USER) }, calls),
        rpc: fakeRpc(calls),
      },
      INPUT,
    );
    expect(out).toEqual({ ok: false, error: 'account_not_staff' });
    expect(calls.some((c) => c.fn === 'onboarding_accept_with_account')).toBe(false);
  });

  it('a malformed token from GoTrue never becomes a link', async () => {
    const calls: Call[] = [];
    const out = await acceptWithAccount(
      { admin: fakeAdmin({ invite: link(NEW_USER, 'short') }, calls), rpc: fakeRpc(calls) },
      INPUT,
    );
    expect(out).toEqual({ ok: false, error: 'activation_link_required' });
    expect(calls.some((c) => c.fn === 'onboarding_accept_with_account')).toBe(false);
  });

  it('passes the database’s refusal through for actions.ts to word', async () => {
    const calls: Call[] = [];
    const out = await acceptWithAccount(
      {
        admin: fakeAdmin({ invite: link(NEW_USER) }, calls),
        rpc: fakeRpc(calls, 'staff_linked_elsewhere'),
      },
      INPUT,
    );
    expect(out).toEqual({ ok: false, error: 'staff_linked_elsewhere' });
  });
});

describe('Resend activation link', () => {
  function resendRpc(
    calls: Call[],
    script: {
      check?: string | null;
      checkData?: unknown;
      write?: string | null;
      writeData?: unknown;
    },
  ): ResendRpc {
    return {
      async rpc(fn: string, args: unknown) {
        calls.push({ fn, args });
        if (fn === 'onboarding_resend_activation_check') {
          return script.check
            ? { data: null, error: { message: script.check } }
            : {
                data: (script.checkData ?? {
                  email: 'mei@example.com',
                  userId: 'u-staff',
                }) as never,
                error: null,
              };
        }
        return script.write
          ? { data: null, error: { message: script.write } }
          : { data: (script.writeData ?? { queued: true, n: 1 }) as never, error: null };
      },
    } as ResendRpc;
  }
  const UNCONFIRMED: AuthUserLike = { ...STAFF_USER, email_confirmed_at: null };

  it('asks the database first, then mints for the linked login, then queues the NEW E3', async () => {
    const calls: Call[] = [];
    const out = await resendActivation(
      {
        admin: fakeAdmin(
          { getUser: { data: { user: UNCONFIRMED }, error: null }, invite: link(UNCONFIRMED) },
          calls,
        ),
        rpc: resendRpc(calls, {}),
      },
      { staffId: 'staff-1', staffOrigin: 'https://app.thc.example' },
    );
    expect(out).toEqual({ ok: true, queued: true, n: 1 });
    expect(calls.map((c) => c.fn)).toEqual([
      'onboarding_resend_activation_check',
      'getUserById',
      'generateLink:invite',
      'onboarding_resend_activation',
    ]);
    expect(calls.at(-1)!.args).toEqual({
      p_staff: 'staff-1',
      p_user: 'u-staff',
      p_activation_link: `https://app.thc.example/activate/${TOKEN}`,
      p_install_link: 'https://app.thc.example/install',
    });
  });

  it('a refusal (too soon, already activated…) mints nothing, so the link in the inbox still works', async () => {
    for (const refusal of ['resend_too_soon: 14:32', 'already_activated', 'not_accepted']) {
      const calls: Call[] = [];
      const out = await resendActivation(
        {
          admin: fakeAdmin({ invite: link(NEW_USER) }, calls),
          rpc: resendRpc(calls, { check: refusal }),
        },
        { staffId: 'staff-1', staffOrigin: 'https://app.thc.example' },
      );
      expect(out).toEqual({ ok: false, error: refusal });
      expect(calls.map((c) => c.fn)).toEqual(['onboarding_resend_activation_check']);
    }
  });

  it('a candidate with no login yet gets one, as at Accept', async () => {
    const calls: Call[] = [];
    await resendActivation(
      {
        admin: fakeAdmin({ invite: link(NEW_USER) }, calls),
        rpc: resendRpc(calls, { checkData: { email: 'mei@example.com', userId: null } }),
      },
      { staffId: 'staff-1', staffOrigin: 'https://app.thc.example' },
    );
    expect(calls.map((c) => c.fn)).toEqual([
      'onboarding_resend_activation_check',
      'generateLink:invite',
      'updateUserById',
      'onboarding_resend_activation',
    ]);
  });

  it('a raced click that only refreshed the pending email reports queued: false', async () => {
    const calls: Call[] = [];
    const out = await resendActivation(
      {
        admin: fakeAdmin(
          { getUser: { data: { user: STAFF_USER }, error: null }, magiclink: link(STAFF_USER) },
          calls,
        ),
        rpc: resendRpc(calls, { writeData: { queued: false, refreshed: true } }),
      },
      { staffId: 'staff-1', staffOrigin: 'https://app.thc.example' },
    );
    expect(out).toEqual({ ok: true, queued: false, n: null });
  });
});
