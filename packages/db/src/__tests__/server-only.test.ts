import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * security.md Invariant 8 — the service-role key never reaches a browser
 * bundle. `createAdminClient()` only ever checked `typeof window` at RUN
 * time; nothing stopped a `'use client'` file importing `@thc/db/admin`
 * and shipping the module. The `server-only` marker closes that at BUILD
 * time: Next aliases it to a throwing module in every non-server layer,
 * and its `next-invalid-import-error-loader` turns the import into a
 * compile error naming the offending file.
 *
 * Two things are pinned here. First, that the marker is the FIRST
 * statement of the two modules that hold credentials or a session — a
 * marker below another import would let that import's side effects run
 * first. Second, that the modules the Deno Edge Function and the browser
 * share stay free of it: `server-only` is a bare specifier Deno cannot
 * resolve (supabase/functions/willo-webhook imports provision.ts and
 * willo.ts by relative path, ADR-0006), and the browser client obviously
 * must load in a browser.
 */
const src = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/** First line of the file that is not a comment or blank. */
function firstStatement(source: string): string {
  const lines = source.split('\n');
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    return line;
  }
  return '';
}

describe("'server-only' marker", () => {
  it.each(['admin.ts', 'server.ts'])('is the first statement of %s', (file) => {
    expect(firstStatement(src(file))).toBe("import 'server-only';");
  });

  it.each([
    'provision.ts',
    'willo.ts',
    'browser.ts',
    'roles.ts',
    'activation.ts',
    'env.ts',
    'session.ts',
  ])('is absent from %s (shared with Deno or the browser)', (file) => {
    expect(src(file)).not.toMatch(/['"]server-only['"]/);
  });

  // Outside a react-server build the package's `default` export condition
  // throws on load — which is exactly what a client bundle would hit. A test
  // that wants the real admin client therefore mocks the module, as every
  // app test already does (vi.mock('@thc/db/admin')).
  it('refuses to load in a non-server module graph', async () => {
    await expect(import('../admin')).rejects.toThrow(/cannot be imported from a Client Component/);
    await expect(import('../server')).rejects.toThrow(/cannot be imported from a Client Component/);
  });
});
