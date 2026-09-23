/**
 * Generates supabase/tests/_shared/rota_guard_vectors.psql from the single
 * source of truth, packages/domain/src/rotaGuard.vectors.json (completion
 * letter requirement §4, acceptance criteria 1, 4, 6).
 *
 * Same shape as cap-vectors.mjs: pgTAP cannot read JSON, so the cases are
 * rendered into a temp table that supabase/tests/362_rota_guard.sql loads
 * with \ir, and the Vitest suite in packages/domain re-renders and compares
 * so the generated file cannot drift from the JSON.
 *
 *   node supabase/tests/_shared/rota-guard-vectors.mjs          # rewrite
 *   node supabase/tests/_shared/rota-guard-vectors.mjs --check  # verify
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROTA_VECTORS_JSON = resolve(
  here,
  '../../../packages/domain/src/rotaGuard.vectors.json',
);
export const ROTA_VECTORS_PSQL = resolve(here, 'rota_guard_vectors.psql');

const sqlBool = (v) => (v ? 'true' : 'false');
const sqlNum = (v) => (v === null || v === undefined ? 'null' : String(v));
const sqlText = (v) =>
  v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`;

/** The .psql file body for a parsed rotaGuard.vectors.json. Pure — no I/O. */
export function renderRotaGuardVectors(vectors) {
  const rows = vectors.cases.map((c) =>
    [
      `  (${sqlText(c.name)},`,
      `${sqlBool(c.input.canRoster)},`,
      `${sqlNum(c.input.capHours)},`,
      `${sqlText(c.input.band)},`,
      `${sqlNum(c.input.bookedHours)},`,
      `${sqlNum(c.input.shiftHours)},`,
      `${sqlText(c.input.mode)},`,
      `${sqlText(c.expect.verdict)},`,
      `${sqlText(c.expect.reason)})`,
    ].join(' '),
  );

  return `-- =====================================================================
-- GENERATED FILE — DO NOT EDIT.
--
-- Source:    packages/domain/src/rotaGuard.vectors.json
-- Generator: node supabase/tests/_shared/rota-guard-vectors.mjs
--
-- The shared rota guard vectors as a table pgTAP can join against. The
-- Vitest suite in packages/domain fails if this file has drifted from the
-- JSON, so rotaGuardVerdict() and rota_guard_decide() are held to the same
-- cases.
-- =====================================================================

create temporary table rota_guard_vectors (
  name           text primary key,
  can_roster     boolean not null,
  cap_hours      int,
  band           text    not null,
  booked_hours   numeric not null,
  shift_hours    numeric not null,
  mode           text    not null,
  expect_verdict text    not null,
  expect_reason  text
) on commit drop;

insert into rota_guard_vectors values
${rows.join(',\n')};

\\set rota_vector_count ${vectors.cases.length}
`;
}

export function readRotaVectors() {
  return JSON.parse(readFileSync(ROTA_VECTORS_JSON, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rendered = renderRotaGuardVectors(readRotaVectors());
  if (process.argv.includes('--check')) {
    if (readFileSync(ROTA_VECTORS_PSQL, 'utf8') !== rendered) {
      console.error(
        'rota_guard_vectors.psql is out of date — run: node supabase/tests/_shared/rota-guard-vectors.mjs',
      );
      process.exit(1);
    }
    console.log('rota_guard_vectors.psql is up to date');
  } else {
    writeFileSync(ROTA_VECTORS_PSQL, rendered);
    console.log(`wrote ${ROTA_VECTORS_PSQL} (${readRotaVectors().cases.length} cases)`);
  }
}
