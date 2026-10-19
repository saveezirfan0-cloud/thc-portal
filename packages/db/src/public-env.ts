/**
 * Build-time aliases for each app's `next.config.ts` `env` (ADR-0165).
 *
 * Supabase's new browser key is `sb_publishable_…`, and its natural variable
 * name is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The code has read
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` in about fifty places — every "is Supabase
 * configured?" check and all three middlewares — as a literal
 * `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`, which Next inlines at build
 * time. Rather than touch each of them, the build defines that literal as
 * the publishable key when one is given, else the anon key, so every reader
 * sees the same value as `supabaseAnonKey()` in env.ts. With neither set,
 * nothing is defined and the usual "Missing …" errors stand.
 *
 * Pure: imported by next.config.ts, which runs in Node at build and dev start.
 */
type Env = Record<string, string | undefined>;

export function supabaseKeyBuildEnv(env: Env = process.env): Record<string, string> {
  const key = env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  return key ? { NEXT_PUBLIC_SUPABASE_ANON_KEY: key } : {};
}
