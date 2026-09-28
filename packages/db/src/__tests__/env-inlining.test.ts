import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Next.js inlines a NEXT_PUBLIC_ variable into the browser bundle only
 * where its full dotted name is written in the source. `process.env[name]`
 * survives the build as a lookup on the browser's empty `process.env`, so
 * every browser client threw "Missing NEXT_PUBLIC_SUPABASE_URL" in
 * production — the Staff App's selfie and document uploads fell to the
 * error boundary — while every server test passed. Nothing at runtime in
 * Node can see the difference, so the source is what is pinned.
 */
describe('env.ts — public Supabase values are inlinable', () => {
  // Code only: the file's own comment quotes the form it forbids.
  const source = readFileSync(new URL('../env.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])(
    'reads %s as a literal process.env property',
    (name) => {
      expect(source).toContain(`process.env.${name}`);
    },
  );

  it('never reads the environment by a computed key', () => {
    expect(source).not.toMatch(/process\.env\[\s*[a-z]/);
  });
});
