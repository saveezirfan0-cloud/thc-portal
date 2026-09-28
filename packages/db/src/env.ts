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

export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env['SUPABASE_SERVICE_ROLE_KEY']);
}
