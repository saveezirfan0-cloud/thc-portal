import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `supabase/functions/auto-staffing` (Deno) imports `autoAssign.ts`
 * straight from this package. Deno resolves every specifier as written, so
 * each relative import on that path must name its `.ts` file — including
 * `import type`, which the deploy bundler still walks. `roundMayInvite`
 * (D33, ADR-0037) needs `bookingReopenableBy`, which is why that function
 * lives in `reopen.ts` with no imports rather than in `state.ts`, whose
 * own imports (`./rtwCheck` → `./onboarding`) carry no extension. The
 * availability gate (ADR-0036) adds `availability.ts` → `time.ts`, both
 * with explicit extensions for the same reason.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function relativeImports(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1] as string);
}

describe('the Edge Function import path stays Deno-resolvable', () => {
  it('every module autoAssign.ts reaches names its .ts file', () => {
    const seen = new Set<string>();
    const queue = ['autoAssign.ts'];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of relativeImports(file)) {
        expect(spec, `${file} imports ${spec}`).toMatch(/\.ts$/);
        queue.push(spec.slice(2));
      }
    }
    expect([...seen].sort()).toEqual([
      'autoAssign.ts',
      'availability.ts',
      'reopen.ts',
      'scoring.ts',
      'time.ts',
    ]);
  });
});
