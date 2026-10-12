/**
 * A2's "If <address> has an account…" (§10.2), carried from A1's action to
 * this page in a flash cookie rather than `?to=` (security review 12.10):
 *
 *   · httpOnly — no script reads it;
 *   · Path=/forgot/sent — sent with this one page's request only;
 *   · five minutes — long enough for the redirect, gone soon after;
 *   · SameSite=Strict — a link from another site cannot make the page
 *     print it.
 *
 * And the page prints it only if it still reads as an email address, so a
 * forged cookie value is never a sentence on a branded page.
 */
export const RESET_SENT_COOKIE = 'thc-reset-sent';

const MAX_AGE_SECONDS = 5 * 60;

export function resetSentCookieOptions() {
  return {
    path: '/forgot/sent',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
  };
}

/** One address, nothing else: no spaces, one @, a dot in the domain, sane length. */
const EMAIL = /^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,253}\.[^\s@<>"'`.]{2,63}$/;

/** The address to show, or null when the value is absent or not an email. */
export function sentAddress(value: string | undefined | null): string | null {
  const text = value?.trim().toLowerCase() ?? '';
  return text.length <= 254 && EMAIL.test(text) ? text : null;
}
