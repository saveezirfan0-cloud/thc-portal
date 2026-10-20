import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Edge Functions' supabase-js (ADR-0165).
 *
 * They imported `https://esm.sh/@supabase/supabase-js@2.45.4` (September
 * 2024) in three places. A client that old sends whatever key it is given
 * as a bearer, and knows nothing of the new `sb_secret_…` keys that replace
 * the legacy service_role JWT at the end of 2026. They now import ONE exact
 * `npm:` version, the same one the apps resolve in pnpm-lock.yaml, so a
 * bump of the apps' client that forgets the functions fails here, and an
 * unpinned or CDN import cannot creep back in.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const FUNCTIONS = join(ROOT, 'supabase', 'functions');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|js|mjs)$/.test(name) ? [path] : [];
  });
}

const specifiers = sources(FUNCTIONS).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']*supabase-js[^']*)'/g)].map((m) => ({
    file: relative(ROOT, file),
    specifier: m[1]!,
  })),
);

function lockedVersion(): string {
  const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  const versions = [...lock.matchAll(/^ {2}'@supabase\/supabase-js@(\d+\.\d+\.\d+)':/gm)].map(
    (m) => m[1]!,
  );
  expect(new Set(versions).size, 'pnpm-lock.yaml resolves exactly one supabase-js').toBe(1);
  return versions[0]!;
}

describe('Edge Functions import one pinned supabase-js', () => {
  it('finds the imports at all (the job wrapper, notify-drain, willo-webhook)', () => {
    expect(specifiers.map((s) => s.file).sort()).toEqual(
      expect.arrayContaining([
        'supabase/functions/_shared/job.ts',
        'supabase/functions/notify-drain/index.ts',
        'supabase/functions/willo-webhook/index.ts',
      ]),
    );
  });

  it('every import is npm:@supabase/supabase-js@<exact version>, never esm.sh or a range', () => {
    for (const { file, specifier } of specifiers) {
      expect(specifier, file).toMatch(/^npm:@supabase\/supabase-js@\d+\.\d+\.\d+$/);
    }
  });

  it("all of them name the same version, and it is the apps' (pnpm-lock.yaml)", () => {
    const versions = new Set(specifiers.map((s) => s.specifier.split('@').pop()));
    expect([...versions]).toEqual([lockedVersion()]);
  });
});
