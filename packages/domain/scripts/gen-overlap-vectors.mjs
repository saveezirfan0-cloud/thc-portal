/**
 * overlap.vectors.json → supabase/tests/_shared/overlap_vectors.psql
 *
 * The vectors are the contract between packages/domain/overlap.ts and the
 * Postgres `booked_elsewhere_conflict()` in the auto-assign migration. Vitest
 * reads the JSON directly; pgTAP cannot, because `supabase test db` runs
 * pg_prove with only supabase/ in reach — so the same cases are generated into
 * a .psql the test includes with \ir. `overlap.vectors.test.ts` fails if this
 * file drifts, so the JSON stays the single source of truth.
 *
 * Deliberately a sibling of gen-vectors-sql.mjs rather than a branch inside
 * it: that script's --stdout contract is what pay.vectors.test.ts compares
 * against, and folding a second source into the same stream would break it.
 *
 *   pnpm --filter @thc/domain gen:vectors
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const VECTORS_PATH = resolve(here, '../src/overlap.vectors.json');
export const OUT_PATH = resolve(here, '../../../supabase/tests/_shared/overlap_vectors.psql');

const text = (value) => `'${value.replaceAll("'", "''")}'`;
const json = (value) => `${text(JSON.stringify(value))}::jsonb`;

export function render(vectors) {
  const rows = vectors.cases.map(
    (c) =>
      `  (${text(c.name)}, ${json({ candidate: c.candidate, held: c.held, gapMinutes: c.gapMinutes })}, ${text(c.expect)})`,
  );

  return [
    '-- =====================================================================',
    '-- GENERATED FILE — do not edit.',
    '--',
    '-- Source: packages/domain/src/overlap.vectors.json',
    '-- Regenerate: pnpm --filter @thc/domain gen:vectors',
    '--',
    '-- The shared booked-elsewhere vectors (§3.4) as a temporary table, for',
    '-- the pgTAP half of the contract. Included with \\ir from',
    '-- supabase/tests/080_auto_assign.sql; the .psql extension keeps pg_prove',
    '-- from running it as a test of its own.',
    '--',
    '-- Windows are ISO instants inside the jsonb; the SQL side casts them.',
    '-- The count is asserted by the test, so a half-loaded table cannot pass.',
    '-- =====================================================================',
    '',
    'create temporary table vec_overlap (name text, input jsonb, expect text) on commit drop;',
    'insert into vec_overlap (name, input, expect) values',
    rows.join(',\n') + ';',
    '',
  ].join('\n');
}

export function generate() {
  return render(JSON.parse(readFileSync(VECTORS_PATH, 'utf8')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--stdout')) {
    process.stdout.write(generate());
  } else {
    writeFileSync(OUT_PATH, generate());
    console.log(`wrote ${OUT_PATH}`);
  }
}
