import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Audit 53: a worker or applicant never sees the scope's section numbers
 * ("§3.6"), rule ids ("RULE-20") or background-job ids ("BG-04"). They stay
 * in comments, identifiers and test names; they do not reach the screen.
 *
 * This reads every non-test source file under app/, strips the comments,
 * and fails on any token left in what remains — JSX text, string
 * literals, error messages, titles, hints and pill labels alike.
 */
const APP = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = /§\s?\d|RULE-\d|BG-\d/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat(block.split('\n').length - 1))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no scope references in the Staff App copy (audit 53)', () => {
  it('finds source files to check', () => {
    expect(sources(APP).length).toBeGreaterThan(50);
  });

  it('leaves §, RULE- and BG- only in comments', () => {
    const hits = sources(APP).flatMap((file) =>
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .flatMap((line, index) =>
          TOKEN.test(line) ? [`${relative(APP, file)}:${index + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });
});
