/**
 * A2 Reset link sent — the two controls under the copy (§10.2,
 * wireframes/staff/auth.html A2): "Open mail app" and
 * "Didn't get it? Resend in 0:48".
 *
 * Pure helpers so the screen can be tested without a browser.
 */

/**
 * How long the Resend button waits before it can be pressed. Long enough for
 * the first email to arrive, short enough that a worker with a typo does not
 * give up. Supabase Auth's own email rate limit stays the backstop behind it.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/** `48` → `0:48`, `60` → `1:00`, never negative. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Where "Open mail app" goes, from the User-Agent, or null when there is no
 * portable way to open an inbox (desktop). There is no `mailto:`-free
 * standard: iOS opens Mail for `message:`, and Android Chrome opens the
 * default mail client for an APP_EMAIL intent. A desktop worker is on the
 * wrong device for the Staff App anyway, so the button is simply absent there
 * rather than a `mailto:` that would open a blank compose window.
 */
export function mailAppHref(userAgent: string | null | undefined): string | null {
  const ua = userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'message://';
  if (/Android/i.test(ua)) {
    return 'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end';
  }
  return null;
}
