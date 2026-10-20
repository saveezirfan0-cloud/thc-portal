/**
 * Reads the Supabase environment, failing loudly rather than at the first query.
 *
 * The two public values are read as LITERAL `process.env.NEXT_PUBLIC_…`
 * expressions, never `process.env[name]`. Next.js inlines a public variable
 * into the browser bundle only where the full dotted name appears in the
 * source; a computed key is left as a lookup on the browser's empty
 * `process.env`, so every browser client (`@thc/db/browser`) threw "Missing
 * NEXT_PUBLIC_SUPABASE_URL" in production while the server was fine — the
 * Staff App's selfie and document uploads fell to the error boundary.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in (docs/04-setup-github-vercel-supabase.md).`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * The browser-safe key: the legacy `anon` JWT or the new `sb_publishable_…`
 * key, which supabase-js 2.118 handles alike (ADR-0165). Two names:
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` wins when set, else
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Each app's `next.config.ts` maps the new
 * name onto the old one at build time as well, so the ~50 literal
 * `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` "configured?" checks and the
 * middlewares see the same value. Both read as literals (see the header).
 */
export function supabaseAnonKey(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The server-only key: the legacy `service_role` JWT or a new `sb_secret_…`
 * key, under the one name either way (ADR-0165), so the server-side
 * "is the service key set?" checks keep reading one variable.
 */
export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env['SUPABASE_SERVICE_ROLE_KEY']);
}
