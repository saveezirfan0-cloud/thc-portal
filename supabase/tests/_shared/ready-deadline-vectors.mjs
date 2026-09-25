/**
 * Generates supabase/tests/_shared/ready_deadline_vectors.psql from the single
 * source of truth, packages/domain/src/readyDeadline.vectors.json (§3.5).
 *
 * Same shape as rota-guard-vectors.mjs: pgTAP cannot read JSON, so the cases
 * are rendered into a temp table that supabase/tests/610_ready_deadline_and_
 * the_day_before.sql loads with \ir, and the Vitest suite in packages/domain
 * re-renders and compares so the generated file cannot drift from the JSON.
 *
 *   node supabase/tests/_shared/ready-deadline-vectors.mjs          # rewrite
 *   node supabase/tests/_shared/ready-deadline-vectors.mjs --check  # verify
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const READY_VECTORS_JSON = resolve(
  here,
  '../../../packages/domain/src/readyDeadline.vectors.json',
);
export const READY_VECTORS_PSQL = resolve(here, 'ready_deadline_vectors.psql');

const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** The .psql file body for a parsed readyDeadline.vectors.json. Pure — no I/O. */
export function renderReadyDeadlineVectors(vectors) {
  const rows = vectors.cases.map(
    (c) =>
      `  (${sqlText(c.name)}, ${sqlText(c.startsAt)}::timestamptz, ${sqlText(c.deadline)}::timestamptz)`,
  );

  return `-- =====================================================================
-- GENERATED FILE — DO NOT EDIT.
--
-- Source:    packages/domain/src/readyDeadline.vectors.json
-- Generator: node supabase/tests/_shared/ready-deadline-vectors.mjs
--
-- The shared §3.5 deadline vectors as a table pgTAP can join against. The
-- Vitest suite in packages/domain fails if this file has drifted from the
-- JSON, so readyDeadline() and ready_deadline() are held to the same cases.
-- =====================================================================

create temporary table ready_deadline_vectors (
  name      text primary key,
  starts_at timestamptz not null,
  deadline  timestamptz not null
) on commit drop;

insert into ready_deadline_vectors values
${rows.join(',\n')};

\\set ready_vector_count ${vectors.cases.length}
`;
}

export function readReadyVectors() {
  return JSON.parse(readFileSync(READY_VECTORS_JSON, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rendered = renderReadyDeadlineVectors(readReadyVectors());
  if (process.argv.includes('--check')) {
    if (readFileSync(READY_VECTORS_PSQL, 'utf8') !== rendered) {
      console.error(
        'ready_deadline_vectors.psql is out of date — run: node supabase/tests/_shared/ready-deadline-vectors.mjs',
      );
      process.exit(1);
    }
    console.log('ready_deadline_vectors.psql is up to date');
  } else {
    writeFileSync(READY_VECTORS_PSQL, rendered);
    console.log(`wrote ${READY_VECTORS_PSQL} (${readReadyVectors().cases.length} cases)`);
  }
}
