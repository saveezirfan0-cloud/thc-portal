/**
 * Is this session one an emailed reset link just made? (§10.2 A3; security
 * review 12.10, finding 1; ADR-0115. The Client Portal and Staff App hold
 * the same rule in their own app/reset/recovery.ts.)
 *
 * /reset changes the password without asking for the current one, which is
 * right only for somebody who has just proved they hold the mailbox. Any
 * other signed-in session — a password sign-in on a desk left unlocked —
 * must use My profile → Password (/account), which asks for the current
 * password.
 *
 * Supabase Auth records how a session was made in the access token's `amr`
 * claim: `recovery` for a reset link (token_hash or PKCE), `otp` for an
 * emailed one-time code. The entry's timestamp is when that proof was
 * given; after RECOVERY_WINDOW_SECONDS the session is an ordinary one.
 */
export const RECOVERY_METHODS: readonly string[] = ['recovery', 'otp'];

/** One hour from opening the link to saving the password. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;

/** The sentence a signed-in visitor without a reset session is given, on the page and from the action. */
export const NOT_A_RESET_SESSION =
  'You are already signed in. To change your password, go to My profile → Password. To reset a forgotten password, sign out and use “Forgot password” on the sign-in screen.';

export function isRecoverySession(
  claims: { amr?: unknown } | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;
  return (amr as unknown[]).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    return (
      typeof method === 'string' &&
      RECOVERY_METHODS.includes(method) &&
      typeof timestamp === 'number' &&
      Number.isFinite(timestamp) &&
      nowSeconds - timestamp <= RECOVERY_WINDOW_SECONDS &&
      timestamp <= nowSeconds + 60
    );
  });
}
