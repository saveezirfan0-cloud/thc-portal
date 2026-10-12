/**
 * Is this session one an emailed reset link just made? (§10.2 A3; security
 * review 12.10, finding 1; ADR-0051, ADR-0115.)
 *
 * /reset changes the password without asking for the current one, which is
 * right only for somebody who has just proved they hold the mailbox. Any
 * other signed-in session — a password sign-in on a laptop left open — must
 * use "Your account → Change password", which re-checks the current
 * password and is throttled per account.
 *
 * Supabase Auth records how a session was made in the access token's `amr`
 * claim: `recovery` for a reset link (token_hash or PKCE), `otp` for an
 * emailed one-time code. Anything else (`password`, `invite`, …) is not a
 * reset session. The entry's timestamp is when that proof was given; a
 * recovery session older than RECOVERY_WINDOW_SECONDS is not one any more
 * (it would otherwise stay one for as long as the device kept refreshing).
 */
export const RECOVERY_METHODS: readonly string[] = ['recovery', 'otp'];

/** One hour from opening the link to saving the password. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;

/** The sentence a signed-in visitor without a reset session is given, on the page and from the action. */
export const NOT_A_RESET_SESSION =
  'You are already signed in. To change your password, go to Your account → Change password. To reset a forgotten password, sign out and use “Forgot password” on the sign-in screen.';

type AmrEntry = string | { method?: unknown; timestamp?: unknown };

export function isRecoverySession(
  claims: { amr?: unknown } | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;
  return (amr as AmrEntry[]).some((entry) => {
    if (typeof entry === 'string') return false; // GoTrue always writes objects; a bare string carries no time.
    const method = typeof entry?.method === 'string' ? entry.method : '';
    if (!RECOVERY_METHODS.includes(method)) return false;
    const at = typeof entry.timestamp === 'number' ? entry.timestamp : NaN;
    return (
      Number.isFinite(at) && nowSeconds - at <= RECOVERY_WINDOW_SECONDS && at <= nowSeconds + 60
    );
  });
}
