/**
 * pay.vectors.json → supabase/tests/_shared/pay_vectors.psql
 *
 * The vectors are the contract between packages/domain/pay.ts and the Postgres
 * functions in supabase/migrations/0005_checkin_checkout.sql. Vitest reads the
 * JSON directly; pgTAP cannot, because `supabase test db` runs pg_prove with
 * only supabase/ in reach — so the same cases are generated into a .psql the
 * test includes with \ir. `pay.vectors.test.ts` fails if this file drifts, so
 * the JSON stays the single source of truth.
 *
 *   pnpm --filter @thc/domain gen:vectors
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const VECTORS_PATH = resolve(here, '../src/pay.vectors.json');
export const OUT_PATH = resolve(here, '../../../supabase/tests/_shared/pay_vectors.psql');

/** Every case carries a complete input: the group's defaults, then its own keys. */
export function merged(group) {
  return group.cases.map((c) => ({ ...c, input: { ...(group.defaults ?? {}), ...c.input } }));
}

const GROUPS = [
  ['vec_check_in', 'checkIn'],
  ['vec_check_out', 'checkOut'],
  ['vec_pay', 'pay'],
  ['vec_turn_away', 'turnAway'],
];

const text = (value) => `'${value.replaceAll("'", "''")}'`;
const json = (value) => `${text(JSON.stringify(value))}::jsonb`;

export function render(vectors) {
  const out = [
    '-- =====================================================================',
    '-- GENERATED FILE — do not edit.',
    '--',
    '-- Source: packages/domain/src/pay.vectors.json',
    '-- Regenerate: pnpm --filter @thc/domain gen:vectors',
    '--',
    '-- The shared §5.1–5.2 vectors as temporary tables, for the pgTAP half of',
    "-- the contract. Group defaults are already merged into each case's input.",
    '-- Included with \\ir from supabase/tests/070_check_in_out.sql; the .psql',
    '-- extension keeps pg_prove from running it as a test of its own.',
    '-- =====================================================================',
    '',
  ];

  for (const [table, key] of GROUPS) {
    const cases = merged(vectors[key]);
    out.push(
      `create temporary table ${table} (name text, input jsonb, expect jsonb) on commit drop;`,
    );
    out.push(`insert into ${table} (name, input, expect) values`);
    out.push(
      cases.map((c) => `  (${text(c.name)}, ${json(c.input)}, ${json(c.expect)})`).join(',\n') +
        ';',
    );
    out.push('');
  }

  return out.join('\n');
}

export function generate() {
  return render(JSON.parse(readFileSync(VECTORS_PATH, 'utf8')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // --stdout is how pay.vectors.test.ts checks the committed file for drift.
  if (process.argv.includes('--stdout')) {
    process.stdout.write(generate());
  } else {
    writeFileSync(OUT_PATH, generate());
    console.log(`wrote ${OUT_PATH}`);
  }
}
