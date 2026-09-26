/**
 * Where an emailed auth link must come back to (§10.2 A1 → A3), per app.
 *
 * The app's own public URL, from its NEXT_PUBLIC_*_URL variable, and
 * nothing guessed in production. VERCEL_URL used to be the fallback: it is
 * the DEPLOYMENT's URL (thc-staff-abc123.vercel.app), which is not in the
 * Supabase redirect allow-list and sits behind Vercel's SSO, so a reset link
 * built on it either landed on the Site URL (another app) or on a login
 * wall. And the Staff App fell back further, to http://127.0.0.1:3001, in
 * production (audit D13). With the variable unset in production there is no
 * safe answer, so none: the caller refuses in words.
 *
 * Locally (NODE_ENV !== 'production') the dev server's own address is used.
 */
export function appOrigin(
  explicit: string | undefined,
  devDefault: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | null {
  const value = explicit?.trim();
  if (value) return value.replace(/\/+$/, '');
  if (nodeEnv === 'production') return null;
  return devDefault;
}

/**
 * The `redirectTo` for resetPasswordForEmail: this app's /auth/confirm.
 *
 * The recovery template (supabase/templates/recovery.html) builds the link
 * from it as `{{ .RedirectTo }}?token_hash=…&type=recovery&next=/reset`, so
 * it carries no query of its own. Should the hosted project still send the
 * default template, GoTrue's /verify redirects here with `?code=`, and
 * /auth/confirm exchanges that too.
 */
export function recoveryRedirect(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/auth/confirm`;
}
