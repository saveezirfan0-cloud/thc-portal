import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { explainInviteEmailError, queueInviteEmail } from '../inviteEmail';

/**
 * E11 (ADR-0038): the office emails a login its set-up link through
 * queue_account_invite, as the signed-in manager. The database decides;
 * this only has to call it with the right arguments and turn a refusal into
 * words.
 */

const USER = '65200000-0000-4000-8000-000000000001';
const LINK =
  'https://office.thc.example/auth/invite?token=0123456789abcdef0123456789abcdef0123456789abcdef01234567';

function client(result: { error: { message: string } | null } | Error) {
  const rpc = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { data: null, ...result };
  });
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

describe('queueInviteEmail', () => {
  it('queues through queue_account_invite with the user and the link', async () => {
    const { rpc, supabase } = client({ error: null });
    await expect(queueInviteEmail(supabase, USER, ` ${LINK} `)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('queue_account_invite', { p_user: USER, p_link: LINK });
  });

  it('never calls the database with something that is not a user id', async () => {
    const { rpc, supabase } = client({ error: null });
    const result = await queueInviteEmail(supabase, 'not-a-uuid', LINK);
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['invite_link_invalid', /not a set-up link/],
    ['login_disabled', /switched off/],
    ['already_signed_in', /Forgot password/],
    ['not_authorised', /Only the office/],
    ['role_not_allowed', /accepted in Onboarding/],
    ['unknown_account', /no longer exists/],
  ])('explains %s', async (code, words) => {
    const { supabase } = client({ error: { message: code } });
    const result = await queueInviteEmail(supabase, USER, LINK);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(words) });
  });

  it('says so, without throwing, when the call itself fails', async () => {
    const { supabase } = client(new Error('fetch failed'));
    const result = await queueInviteEmail(supabase, USER, LINK);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/Copy the link/) });
  });

  it('falls back to a generic sentence for a code it does not know', () => {
    expect(explainInviteEmailError('something_else')).toMatch(/Try again/);
  });
});
