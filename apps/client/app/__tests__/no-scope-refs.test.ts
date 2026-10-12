import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Audit 53: a client never sees the scope's section numbers ("§11.4"),
 * rule ids ("RULE-18") or background-job ids ("BG-08"). They stay in
 * comments, identifiers and test names; they do not reach the screen.
 *
 * The same holds for the rest of the builders' vocabulary: decision records
 * ("ADR-0004"), repository paths ("See docs/04-setup-…"), notification codes
 * from the §8 register ("N6b", "CR1") and the name of the database vendor
 * ("this environment has no Supabase project"). A customer can act on none
 * of it.
 *
 * This reads every non-test source file under app/, plus middleware.ts (its
 * wrong-app page is customer copy too), strips the comments and import
 * lines, and fails on any token left in what remains — JSX text, string
 * literals, error messages, titles, hints and pill labels alike.
 */
const APP = fileURLToPath(new URL('..', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const TOKENS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'scope section', pattern: /§\s?\d/ },
  { name: 'rule id', pattern: /RULE-\d/ },
  { name: 'job id', pattern: /BG-\d/ },
  { name: 'decision record', pattern: /ADR-\d/ },
  { name: 'repository path', pattern: /\bdocs\// },
  // N1…N20 with an optional letter (N6b); CR1/CR2 (ADR-0110).
  { name: 'notification code', pattern: /\bN\d{1,2}[a-z]?\b|\bCR\d+\b/ },
  // The word, not identifiers like `SupabaseClient` or the '@supabase/ssr'
  // package (import lines are dropped below anyway).
  { name: 'vendor name', pattern: /\bSupabase\b/ },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function files(): string[] {
  return [...sources(APP), join(ROOT, 'middleware.ts')];
}

/** Comments become blank lines (so line numbers hold); imports are code. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat(block.split('\n').length - 1))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/^\s*(import|export)\b[^\n]*\bfrom\s+['"][^'"\n]+['"];?[ \t]*$/gm, '');
}

function hits(source: string): { line: number; token: string; text: string }[] {
  return withoutComments(source)
    .split('\n')
    .flatMap((text, index) =>
      TOKENS.filter((t) => t.pattern.test(text)).map((t) => ({
        line: index + 1,
        token: t.name,
        text: text.trim(),
      })),
    );
}

describe('no scope references in the Client Portal copy (audit 53)', () => {
  it('finds source files to check, middleware included', () => {
    const all = files();
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((f) => f.endsWith('middleware.ts'))).toBe(true);
  });

  it('leaves §, RULE-, BG-, ADR-, docs/, notification codes and "Supabase" only in comments', () => {
    const found = files().flatMap((file) =>
      hits(readFileSync(file, 'utf8')).map(
        (h) => `${relative(ROOT, file)}:${h.line}: [${h.token}] ${h.text}`,
      ),
    );
    expect(found).toEqual([]);
  });

  // The scanner itself: it must catch the tokens in copy and ignore them in
  // comments and imports, or the test above proves nothing.
  it('catches the tokens in strings and JSX text', () => {
    const sample = [
      `const a = 'See docs/04-setup-github-vercel-supabase.md';`,
      `const b = "This environment has no Supabase project.";`,
      `const c = <p>Per ADR-0089 we send N6b and CR1.</p>;`,
      'const d = `§11.4 says so`;',
    ].join('\n');
    const tokens = hits(sample).map((h) => h.token);
    expect(tokens).toEqual(
      expect.arrayContaining([
        'repository path',
        'vendor name',
        'decision record',
        'notification code',
        'scope section',
      ]),
    );
  });

  it('ignores comments, imports and identifiers', () => {
    const sample = [
      `import { createServerClient } from '@supabase/ssr';`,
      `import type { SupabaseClient } from '@supabase/supabase-js';`,
      `// ADR-0004: see docs/01-architecture.md, N6b, CR1, Supabase`,
      `/* §11.1 · RULE-18 · BG-08 */`,
      `const client: SupabaseClient = createServerClient(url, key);`,
      `const NOT_A_CODE = 'Nine';`,
      `const url = 'https://example.com/path'; // Supabase`,
    ].join('\n');
    expect(hits(sample)).toEqual([]);
  });
});
