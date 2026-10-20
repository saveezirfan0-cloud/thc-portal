import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseAnonKey, supabaseServiceRoleKey } from '../env';
import { supabaseKeyBuildEnv } from '../public-env';

/**
 * ADR-0165: the apps take Supabase's new publishable key under its own name,
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and keep NEXT_PUBLIC_SUPABASE_ANON_KEY
 * working. The publishable name wins when both are set, in env.ts and in the
 * build-time alias alike, so no reader can see a different key from another.
 */

const ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
const PUBLISHABLE = 'sb_publishable_Default0123456789abcd';
const SECRET = 'sb_secret_Vercel0123456789abcdef';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('supabaseAnonKey()', () => {
  it('the legacy name alone still works, unchanged', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON);
    expect(supabaseAnonKey()).toBe(ANON);
  });

  it('the publishable name alone works', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE);
    expect(supabaseAnonKey()).toBe(PUBLISHABLE);
  });

  it('the new key may also simply sit under the old name', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', PUBLISHABLE);
    expect(supabaseAnonKey()).toBe(PUBLISHABLE);
  });

  it('both set: the publishable name wins', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE);
    expect(supabaseAnonKey()).toBe(PUBLISHABLE);
  });

  it('neither set: the error names both', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    expect(() => supabaseAnonKey()).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY \(or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\)/,
    );
  });

  it('the server key keeps one name and takes either form', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SECRET);
    expect(supabaseServiceRoleKey()).toBe(SECRET);
  });
});

describe('supabaseKeyBuildEnv() — the next.config.ts alias', () => {
  it('defines the old literal as the publishable key when one is given', () => {
    expect(
      supabaseKeyBuildEnv({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      }),
    ).toEqual({ NEXT_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE });
    expect(supabaseKeyBuildEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })).toEqual({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE,
    });
  });

  it('else the anon key as it is, and nothing at all when neither is set', () => {
    expect(supabaseKeyBuildEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON })).toEqual({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
    });
    expect(supabaseKeyBuildEnv({})).toEqual({});
    expect(supabaseKeyBuildEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' })).toEqual({});
  });

  it.each(['office', 'staff', 'client'])(
    "apps/%s/next.config.ts spreads it into the app's env",
    (app) => {
      const source = readFileSync(
        join(__dirname, '..', '..', '..', '..', 'apps', app, 'next.config.ts'),
        'utf8',
      );
      expect(source).toContain("import { supabaseKeyBuildEnv } from '@thc/db/public-env';");
      expect(source).toMatch(/env:\s*\{[\s\S]*\.\.\.supabaseKeyBuildEnv\(\)/);
    },
  );

  it('turbo passes the new name through to the builds', () => {
    const turbo = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '..', 'turbo.json'), 'utf8'),
    ) as { globalPassThroughEnv: string[] };
    expect(turbo.globalPassThroughEnv).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });
});
