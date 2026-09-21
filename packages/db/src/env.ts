/** Reads the Supabase environment, failing loudly rather than at the first query. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in (docs/04-setup-github-vercel-supabase.md).`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL');
}

export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY');
}
