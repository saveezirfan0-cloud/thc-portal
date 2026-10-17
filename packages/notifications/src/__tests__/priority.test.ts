import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_EMAILS } from '../documents';
import { PRIORITY, SEND_PRIORITY, priorityValuesSql, sendPriority } from '../priority';
import { CHASER_CODES, INVITE_CODES, TEMPLATES } from '../templates';

/**
 * ADR-0156. The send classes are written twice — SEND_PRIORITY here and
 * notification_priorities() in SQL — so these tests hold the two, and the
 * pgTAP file's code list, to the register.
 */

const MIGRATIONS = new URL('../../../../supabase/migrations/', import.meta.url);
const PGTAP = new URL('../../../../supabase/tests/856_notify_drain_priority.sql', import.meta.url);

const registerCodes = [...Object.keys(TEMPLATES), ...Object.keys(DOCUMENT_EMAILS)].sort();

/** The latest migration that (re)defines notification_priorities(), and its rows. */
function sqlMapping(): { file: string; rows: Record<string, number> } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const defining = files.filter((f) =>
    /create or replace function public\.notification_priorities\(\)/i.test(
      readFileSync(new URL(f, MIGRATIONS), 'utf8'),
    ),
  );
  const file = defining.at(-1);
  if (!file) throw new Error('no migration defines notification_priorities()');
  const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
  const fn = sql.slice(sql.search(/function public\.notification_priorities\(\)/i));
  const values = fn.slice(fn.indexOf('(values'), fn.indexOf(') as v(code, priority)'));
  const rows: Record<string, number> = {};
  for (const m of values.matchAll(/\('([A-Za-z0-9]+)',\s*(\d+)\)/g)) {
    if (m[1]! in rows) throw new Error(`${file}: ${m[1]} is listed twice`);
    rows[m[1]!] = Number(m[2]);
  }
  return { file, rows };
}

describe('send priority (ADR-0156)', () => {
  it('gives every register code and document email a class, and nothing else', () => {
    expect(Object.keys(SEND_PRIORITY).sort()).toEqual(registerCodes);
  });

  it('is mirrored exactly by the latest notification_priorities() migration', () => {
    const { file, rows } = sqlMapping();
    const expected = Object.fromEntries(Object.entries(SEND_PRIORITY));
    // On a mismatch, paste priorityValuesSql() into a new migration.
    expect(
      rows,
      `${file} differs from SEND_PRIORITY; its values should be:\n${priorityValuesSql()}`,
    ).toEqual(expected);
  });

  it('keeps the pgTAP code list (856) equal to the register', () => {
    const sql = readFileSync(PGTAP, 'utf8');
    const block = sql.slice(
      sql.indexOf('-- register-codes:begin'),
      sql.indexOf('-- register-codes:end'),
    );
    const codes = [...block.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]!).sort();
    expect(codes).toEqual(registerCodes);
  });

  it('puts the time-critical sends first and the daily sweeps last', () => {
    for (const code of [
      'N5',
      'N6',
      'N6b',
      'N7',
      'N9',
      'N9b',
      'N10b',
      'N10d',
      'N11',
      'N12',
    ] as const)
      expect(SEND_PRIORITY[code], code).toBe(PRIORITY.urgent);
    for (const code of [...CHASER_CODES, ...INVITE_CODES, 'N1', 'N2', 'N3'] as const)
      expect(SEND_PRIORITY[code], code).toBe(PRIORITY.bulk);
    expect(SEND_PRIORITY.E3).toBe(PRIORITY.normal);
    expect(SEND_PRIORITY.BG08).toBe(PRIORITY.normal);
  });

  it('treats an unknown code as normal, as notification_priority() does', () => {
    expect(sendPriority('N99')).toBe(PRIORITY.normal);
    expect(sendPriority('toString')).toBe(PRIORITY.normal);
    expect(sendPriority('N9')).toBe(PRIORITY.urgent);
  });

  it('renders one sorted values row per code', () => {
    const lines = priorityValuesSql().split('\n');
    expect(lines).toHaveLength(registerCodes.length);
    expect(lines[0]).toBe(`    ('BG08', 1),`);
    expect(lines.at(-1)).toMatch(/^ {4}\('[A-Za-z0-9]+', [0-2]\)$/);
  });
});
