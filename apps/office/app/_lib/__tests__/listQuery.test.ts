import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { oneOf, pageIndex, pageParam, readQuery, sizeOf, writeQuery } from '../listQuery';

/** Release audit L1 / m5: a list's state lives in the URL. */
const DEFAULTS = { tab: 'all', q: '', page: '1', size: '25' } as const;

describe('a list query in the URL', () => {
  it('reads every key, defaults filled in', () => {
    expect(readQuery('q=amara&page=3&other=x', DEFAULTS)).toEqual({
      tab: 'all',
      q: 'amara',
      page: '3',
      size: '25',
    });
  });

  it('never writes a default: an untouched list is the bare path', () => {
    expect(writeQuery('', DEFAULTS, { ...DEFAULTS })).toBe('');
    expect(writeQuery('', DEFAULTS, { ...DEFAULTS, tab: 'blocked', page: '1' })).toBe(
      'tab=blocked',
    );
  });

  it('keeps keys the list does not own (e.g. /staff?view=student)', () => {
    expect(writeQuery('view=student&q=old', DEFAULTS, { ...DEFAULTS, q: 'new name' })).toBe(
      'view=student&q=new+name',
    );
  });

  it('round-trips what it writes', () => {
    const values = { tab: 'inactive', q: 'Ros & co', page: '2', size: '50' };
    expect(readQuery(writeQuery('', DEFAULTS, values), DEFAULTS)).toEqual(values);
  });

  it('holds a hand-edited URL to the values the screen knows', () => {
    expect(oneOf('blocked', ['all', 'blocked'] as const, 'all')).toBe('blocked');
    expect(oneOf('<script>', ['all', 'blocked'] as const, 'all')).toBe('all');
    expect(pageIndex('3')).toBe(2);
    expect(pageIndex('0')).toBe(0);
    expect(pageIndex('abc')).toBe(0);
    expect(pageParam(0)).toBe('1');
    expect(pageParam(4)).toBe('5');
    expect(sizeOf('50', [10, 25, 50] as const, 25)).toBe(50);
    expect(sizeOf('7', [10, 25, 50] as const, 25)).toBe(25);
  });

  it('mirrors to the address bar with the History API, never a router navigation (ADR-0109)', () => {
    // A query-only router navigation under a loading.tsx or <Suspense>
    // froze on the old state in production; the History API asks the
    // router for nothing, so /venues' and /users' loading.tsx and
    // /compliance's streamed body stay safe.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'listQuery.ts'),
      'utf8',
    );
    expect(src).toMatch(/window\.history\.(pushState|replaceState)/);
    expect(src).not.toMatch(/\buseRouter\b/);
  });
});
