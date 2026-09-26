/**
 * Emailing a Back Office or Client Portal login its set-up link — E11
 * (ADR-0058).
 *
 * /users mints the link (ADR-0055) and then calls this with the signed-in
 * manager's own client. `queue_account_invite` decides everything — admin
 * only, never a worker's, a switched-off or an already-used login, only an
 * /auth/invite link with a token — and reads the address and the name from
 * the login itself, so nothing here can point the email anywhere else. The
 * row goes through `notification_outbox` like every other send, keyed
 * E11:invite:<user>:<n>: calling this twice with the same link queues one
 * email; a new link queues a new one and withdraws the older unsent one.
 *
 * Never throws. A refusal comes back as a sentence the manager can act on,
 * and the link on screen still works, so the caller shows both.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { explainAccountError } from './accounts';

export type InviteEmailResult = { ok: true } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** queue_account_invite's own refusals (20261001200200); the rest are ADR-0055's. */
const MESSAGES: Readonly<Record<string, string>> = {
  invite_link_invalid:
    'The link could not be emailed because it is not a set-up link. Copy it and send it yourself.',
  login_disabled: 'This login is switched off, so no email was sent. Switch it on first.',
  already_signed_in:
    'This person already uses their login, so no email was sent. They can reset their own password with “Forgot password” on the sign-in screen.',
};

export function explainInviteEmailError(message: string): string {
  const code = message.split(':')[0]?.trim() ?? '';
  return MESSAGES[code] ?? explainAccountError(message);
}

export async function queueInviteEmail(
  supabase: SupabaseClient,
  userId: string,
  link: string,
): Promise<InviteEmailResult> {
  if (!UUID.test(userId)) return { ok: false, message: explainAccountError('unknown_account') };
  try {
    const { error } = await supabase.rpc('queue_account_invite', {
      p_user: userId,
      p_link: link.trim(),
    });
    if (error) return { ok: false, message: explainInviteEmailError(error.message) };
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: 'The email could not be queued. Copy the link and send it yourself, or try again.',
    };
  }
}
