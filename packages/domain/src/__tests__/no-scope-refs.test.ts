import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Audit 53: the refusal and message copy in this package is shown as-is by
 * the three apps (the event board's refusal tables, the Staff App's accept
 * and apply popups, the gov.uk check's review reasons). None of it may carry
 * the scope's section numbers ("§3.6"), rule ids ("RULE-20") or
 * background-job ids ("BG-04"); they stay in comments and identifiers.
 *
 * Only the `.ts` sources are read. The `*.vectors.json` files are test
 * vectors shared with pgTAP — their `ref` and `name` fields cite the scope
 * on purpose and are never rendered.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = /§\s?\d|RULE-\d|BG-\d/;

function sources(): string[] {
  return readdirSync(SRC).filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name));
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat(block.split('\n').length - 1))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no scope references in the domain copy (audit 53)', () => {
  it('finds source files to check', () => {
    expect(sources().length).toBeGreaterThan(10);
  });

  it('leaves §, RULE- and BG- only in comments', () => {
    const hits = sources().flatMap((file) =>
      withoutComments(readFileSync(join(SRC, file), 'utf8'))
        .split('\n')
        .flatMap((line, index) =>
          TOKEN.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });
});
