import { describe, expect, it, vi } from 'vitest';
import { type InviteAdmin, inviteLink, inviteMailto, mintLogin, refuseBeforeMint } from '../invite';

const TOKEN = 'a'.repeat(56);

function fakeAdmin(
  responses: Array<Awaited<ReturnType<InviteAdmin['generateLink']>>>,
): InviteAdmin & {
  generateLink: ReturnType<typeof vi.fn>;
} {
  const generateLink = vi.fn();
  for (const response of responses) generateLink.mockResolvedValueOnce(response);
  return { generateLink };
}

const user = (role?: string) => ({
  id: 'u1',
  email: 'new@thc.test',
  app_metadata: role ? { role } : {},
});

describe('mintLogin', () => {
  it('invites an address GoTrue has not seen', async () => {
    const admin = fakeAdmin([
      { data: { user: user(), properties: { hashed_token: TOKEN } }, error: null },
    ]);
    await expect(mintLogin(admin, 'new@thc.test', 'admin')).resolves.toEqual({
      ok: true,
      userId: 'u1',
      tokenHash: TOKEN,
      type: 'invite',
    });
    expect(admin.generateLink).toHaveBeenCalledWith({ type: 'invite', email: 'new@thc.test' });
  });

  it('falls back to a magic link for an address that already has a login', async () => {
    const admin = fakeAdmin([
      {
        data: null,
        error: {
          message: 'A user with this email address has already been registered',
          code: 'email_exists',
        },
      },
      { data: { user: user('client'), properties: { hashed_token: TOKEN } }, error: null },
    ]);
    const minted = await mintLogin(admin, 'new@thc.test', 'client');
    expect(minted).toMatchObject({ ok: true, type: 'magiclink' });
  });

  it('refuses a login of another kind — a worker’s email never becomes an admin', async () => {
    const admin = fakeAdmin([
      { data: null, error: { message: 'already registered', code: 'email_exists' } },
      { data: { user: user('staff'), properties: { hashed_token: TOKEN } }, error: null },
    ]);
    await expect(mintLogin(admin, 'worker@thc.test', 'admin')).resolves.toEqual({
      ok: false,
      code: 'account_has_other_role',
    });
  });

  it('reports a failed mint without a token', async () => {
    const admin = fakeAdmin([
      { data: { user: user(), properties: { hashed_token: '' } }, error: null },
    ]);
    await expect(mintLogin(admin, 'new@thc.test', 'admin')).resolves.toMatchObject({
      ok: false,
      code: 'account_link_failed',
    });
  });
});

describe('inviteLink', () => {
  it('lands on the app’s own /auth/invite, where the token is spent only on submit', () => {
    expect(inviteLink('https://office.thc.test/', TOKEN, 'invite')).toBe(
      `https://office.thc.test/auth/invite?token=${TOKEN}`,
    );
    expect(inviteLink('https://client.thc.test', TOKEN, 'magiclink')).toBe(
      `https://client.thc.test/auth/invite?token=${TOKEN}&type=magiclink`,
    );
  });

  it('refuses anything that is not an origin or a hashed token', () => {
    expect(() => inviteLink('https://thc.test/path', TOKEN, 'invite')).toThrow(/not an origin/);
    expect(() => inviteLink('https://thc.test', 'short', 'invite')).toThrow(/hashed token/);
  });
});

describe('inviteMailto', () => {
  it('prefills the address, a subject naming the app and the link', () => {
    const href = inviteMailto({
      email: 'amy@client.test',
      name: 'Amy Pond',
      role: 'client',
      link: `https://client.thc.test/auth/invite?token=${TOKEN}`,
    });
    expect(href.startsWith('mailto:amy%40client.test?subject=')).toBe(true);
    const body = decodeURIComponent(href.split('body=')[1] ?? '');
    expect(decodeURIComponent(href)).toContain('Your THC Client Portal login');
    expect(body).toContain('Hi Amy,');
    expect(body).toContain(TOKEN);
  });
});

describe('refuseBeforeMint', () => {
  it('lets a new address through', () => {
    expect(refuseBeforeMint({ exists: false }, 'admin', null)).toBeNull();
  });

  it('refuses a worker’s login and a login of another kind, before a token exists', () => {
    expect(refuseBeforeMint({ exists: true, role: 'staff', isStaff: true }, 'admin', null)).toBe(
      'account_has_other_role',
    );
    expect(refuseBeforeMint({ exists: true, role: 'client', clientId: 'c1' }, 'admin', null)).toBe(
      'account_has_other_role',
    );
  });

  it('never moves a client login to another client', () => {
    expect(refuseBeforeMint({ exists: true, role: 'client', clientId: 'c1' }, 'client', 'c2')).toBe(
      'account_has_other_client',
    );
  });

  it('issues no link for a login someone already uses — that would be a takeover', () => {
    expect(refuseBeforeMint({ exists: true, role: 'admin', signedIn: true }, 'admin', null)).toBe(
      'already_signed_in',
    );
    expect(
      refuseBeforeMint({ exists: true, role: 'admin', signedIn: false }, 'admin', null),
    ).toBeNull();
  });
});
