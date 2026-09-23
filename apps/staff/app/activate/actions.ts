'use server';

import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { isActivationToken, parseActivationType } from '@thc/db/activation';
import { HELP_EMAIL } from '../profile/types';
import { EXPIRED_MESSAGE } from './copy';
import { activationError, activationOk, checkActivationPassword } from './rules';

/**
 * "Activate my account" — §1.4, §2.7, §2.8 (E3), wireframes/public/activate.html.
 *
 * The one-time token is spent HERE, on submit, and never when the page
 * loads: mail scanners open every link in an email before the person
 * does, and a page that verified on load would hand the candidate a spent
 * link every time.
 *
 * Order: the rules that need nobody (length, a number, a letter, a match)
 * are checked before the token is touched, so a typo costs nothing. Only
 * then verifyOtp → a session → updateUser({ password }). "Not your name
 * or email" is checked again after verifyOtp against the account itself,
 * because the page's greeting is best-effort.
 *
 * If anything after verifyOtp refuses the password (that rule, or
 * Supabase's leaked-password check), the token is already spent. The
 * candidate must still be able to try again with the same link, so a
 * short-lived, httpOnly marker records "this browser verified this
 * token", and a retry with it continues on the session verifyOtp left
 * behind. Without the marker, a spent link is a spent link: a session
 * that belongs to somebody else on the same phone is never used.
 */

export interface ActivateState {
  error: string | null;
  /** The link is spent or expired: the form gives way to the help line. */
  expired?: boolean;
}

const MARKER = 'thc-activation';

function marker(token: string): string {
  return createHash('sha256').update(`activation:${token}`).digest('hex');
}

export async function activateAccount(
  _prev: ActivateState,
  formData: FormData,
): Promise<ActivateState> {
  const token = formData.get('token');
  const type = parseActivationType(formData.get('type'));
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!isActivationToken(token)) return { error: EXPIRED_MESSAGE, expired: true };

  const early = checkActivationPassword(password, confirm, null);
  if (!activationOk(early)) return { error: activationError(early) };

  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return {
      error: 'Activation is not available yet — this environment has no Supabase project.',
    };
  }

  const jar = await cookies();
  const supabase = createClient(jar);
  const mark = marker(token);

  let user: { id: string; email?: string | null; app_metadata?: Record<string, unknown> } | null =
    null;
  const verified = await supabase.auth.verifyOtp({ token_hash: token, type });
  if (!verified.error && verified.data.user) {
    user = verified.data.user;
    jar.set(MARKER, mark, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/activate',
      maxAge: 60 * 60,
    });
  } else {
    if (jar.get(MARKER)?.value === mark) {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    }
    if (!user) {
      if (verified.error) {
        console.error('[activate] verify failed', {
          status: verified.error.status,
          code: verified.error.code,
        });
      }
      return { error: EXPIRED_MESSAGE, expired: true };
    }
  }

  // The Staff App admits `staff` and nothing else (§1.4). An office or
  // client link that found its way here is not activated from this app.
  if (user.app_metadata?.['role'] !== 'staff') {
    await supabase.auth.signOut({ scope: 'local' });
    jar.delete(MARKER);
    return {
      error: `This link is not for a Staff App account. Write to ${HELP_EMAIL} if you think it should be.`,
      expired: true,
    };
  }

  const { data: me } = await supabase
    .from('staff')
    .select('first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle<{ first_name: string; last_name: string }>();
  const full = checkActivationPassword(password, confirm, {
    firstName: me?.first_name,
    lastName: me?.last_name,
    email: user.email,
  });
  if (!activationOk(full)) return { error: activationError(full) };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[activate] password update failed', {
      status: error.status,
      code: error.code,
    });
    const text = error.message.toLowerCase();
    return {
      error:
        text.includes('weak') || text.includes('pwned')
          ? 'That password has appeared in a known data breach. Choose a different one.'
          : 'We could not set that password. Try again.',
    };
  }

  jar.delete(MARKER);
  // §2.7: activated → "download the app". Activation does not move the
  // pipeline (the candidate stays in Documents); the wizard is next.
  redirect('/activate/done');
}
