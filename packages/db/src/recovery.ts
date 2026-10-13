/**
 * Is this session one an emailed reset link made, a moment ago? — the gate
 * on A3 (/reset, §10.2) in all three apps.
 *
 * /reset sets a password with nothing but the session: no current password
 * is asked for, because the person there has forgotten it. That is safe only
 * when the session itself is the proof — made from the recovery link, in
 * the last few minutes. Any other signed-in session (a password sign-in, a
 * borrowed laptop, a stolen cookie) must use the app's own change-password
 * screen, which asks for the current password: Profile → Security settings
 * (Staff App), /account (Back Office), Your account (Client Portal).
 *
 * The proof is the access token's `amr` claim, read from VERIFIED claims
 * (`getClaims()`: signature and expiry checked, ADR-0108). GoTrue records
 * how the session was made and when:
 *
 *   'otp'       verifyOtp({ type: 'recovery', token_hash }) — POST /verify,
 *               which issues every email-link session as OTP. This is what
 *               /auth/confirm makes from supabase/templates/recovery.html.
 *   'recovery'  the default template's GET /verify → PKCE `code` →
 *               exchangeCodeForSession; the flow state keeps the link type.
 *
 * The timestamp is the moment of that authentication and survives token
 * refreshes, so "within RECOVERY_WINDOW_SECONDS" is measured from the click
 * on the link, not from the last refresh. A list of bare strings (the older
 * `amr` form) carries no time and never passes.
 *
 * Pure: no `server-only`, no Next import.
 */

/** How long after the link was opened a password may be set without the old one. */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

/** The `amr` methods an emailed reset link produces (see the header). */
export const RECOVERY_METHODS: readonly string[] = ['recovery', 'otp'];

/** Clock skew tolerated for a timestamp a little in the future. */
const SKEW_SECONDS = 60;

/**
 * True when the verified claims record a recovery/OTP authentication no
 * older than `windowSeconds`. Anything unreadable is false.
 */
export function isRecentRecoverySession(
  claims: unknown,
  nowMs: number = Date.now(),
  windowSeconds: number = RECOVERY_WINDOW_SECONDS,
): boolean {
  if (typeof claims !== 'object' || claims === null) return false;
  const amr = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return false;
  const now = Math.floor(nowMs / 1000);
  return amr.some((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== 'string' || !RECOVERY_METHODS.includes(method)) return false;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false;
    return timestamp <= now + SKEW_SECONDS && now - timestamp <= windowSeconds;
  });
}

/** The slice of a Supabase client this needs; any server client satisfies it. */
export interface ClaimsReader {
  auth: {
    getClaims(): Promise<{ data: { claims: object } | null; error?: unknown }>;
  };
}

export interface RecoverySession {
  /**
   *   'none'    no verified session at all (the link was spent, or never opened);
   *   'other'   signed in, but not by a reset link in the last 15 minutes;
   *   'recent'  a reset link, just now: /reset may set the password.
   */
  state: 'none' | 'other' | 'recent';
  /** The verified email, shown on /reset so nobody sets a password on an account they did not mean to. */
  email: string | null;
}

/** Read the verified claims once and classify the session. */
export async function readRecoverySession(
  supabase: ClaimsReader,
  nowMs: number = Date.now(),
): Promise<RecoverySession> {
  let claims: object | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims ?? null;
  } catch {
    claims = null;
  }
  if (!claims) return { state: 'none', email: null };
  const email = (claims as { email?: unknown }).email;
  return {
    state: isRecentRecoverySession(claims, nowMs) ? 'recent' : 'other',
    email: typeof email === 'string' && email ? email : null,
  };
}

/**
 * The address A2 ("Check your inbox") reads back from `?to=`, or null when
 * the value is not shaped like one. The query is anybody's to write: a link
 * to /forgot/sent?to=Call%200800… would otherwise put a stranger's sentence
 * inside a genuine THC screen. React escapes it either way; this keeps it to
 * one plausible address of at most 254 characters.
 */
export function shownEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length > 254) return null;
  return /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[^\s@<>()[\]\\,;:"'.]+$/.test(text)
    ? text
    : null;
}
