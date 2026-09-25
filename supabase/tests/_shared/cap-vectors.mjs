/**
 * Generates supabase/tests/_shared/cap_vectors.psql from the single source of
 * truth, packages/domain/src/cap.vectors.json (RULE-20, Scope §4.4–4.5).
 *
 * The vectors are the contract between the TypeScript `weeklyCap()` and the
 * SQL `weekly_cap()`. pgTAP cannot read JSON, so the cases are rendered into a
 * temp table that supabase/tests/090_weekly_cap.sql loads with \ir. The Vitest
 * suite in packages/domain re-renders and compares, so the generated file
 * cannot silently drift from the JSON.
 *
 *   node supabase/tests/_shared/cap-vectors.mjs          # rewrite the file
 *   node supabase/tests/_shared/cap-vectors.mjs --check  # fail if it drifted
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const VECTORS_JSON = resolve(here, '../../../packages/domain/src/cap.vectors.json');
export const VECTORS_PSQL = resolve(here, 'cap_vectors.psql');

const sqlBool = (v) => (v ? 'true' : 'false');
const sqlInt = (v) => (v === null ? 'null' : String(v));
const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;
/** Optional dated facts: absent means "not on file", which is SQL null. */
const sqlDate = (v) => (v === undefined || v === null ? 'null' : `'${v}'::date`);
const sqlOptBool = (v) => (v === undefined ? 'false' : sqlBool(v));
/** Optional numbers: absent or null means "none recorded", which is SQL null. */
const sqlOptInt = (v) => (v === undefined || v === null ? 'null' : String(v));

/** The .psql file body for a parsed cap.vectors.json. Pure — no I/O. */
export function renderCapVectors(vectors) {
  const rows = vectors.cases.map((c) =>
    [
      `  (${sqlText(c.name)},`,
      `${sqlBool(c.input.visaLimited)},`,
      `${sqlText(c.input.termState)},`,
      `${sqlBool(c.input.completionLetterVerified)},`,
      `${sqlBool(c.input.optOut48h)},`,
      `${sqlDate(c.input.weekStart)},`,
      `${sqlOptBool(c.input.belowDegreeLevel)},`,
      `${sqlDate(c.input.completionDate)},`,
      `${sqlDate(c.input.visaExpiry)},`,
      `${sqlDate(c.input.optOutCancelledFrom)},`,
      `${sqlOptBool(c.input.under18)},`,
      `${sqlDate(c.input.verifiedOn)},`,
      `${sqlOptInt(c.input.visaHourLimit)},`,
      `${sqlInt(c.expect.capHours)},`,
      `${sqlText(c.expect.band)})`,
    ].join(' '),
  );

  return `-- =====================================================================
-- GENERATED FILE — DO NOT EDIT.
--
-- Source:    packages/domain/src/cap.vectors.json
-- Generator: node supabase/tests/_shared/cap-vectors.mjs
--
-- The shared RULE-20 cap vectors (§4.4–4.5) as a table pgTAP can join
-- against. The Vitest suite in packages/domain fails if this file has
-- drifted from the JSON, so the TypeScript and SQL implementations can
-- never be held to different cases.
--
-- .psql, not .sql, so that \`supabase test db\` (pg_prove --ext .pg
-- --ext .sql) does not try to run it as a test of its own.
-- =====================================================================

create temporary table cap_vectors (
  name                       text primary key,
  visa_limited               boolean not null,
  term_state                 text    not null,
  completion_letter_verified boolean not null,
  optout_48h                 boolean not null,
  -- University Completion Letter Requirement (docs/scope/). Null means the
  -- fact is not on file, which is what the original vectors carry.
  week_start                 date,
  below_degree_level         boolean not null,
  completion_date            date,
  visa_expiry                date,
  optout_cancelled_from      date,
  under18                    boolean not null,
  -- Fix round 29.09 (D35, D36): the day the completion letter was verified,
  -- and a weekly hours limit written on a work or dependant visa.
  verified_on                date,
  visa_hour_limit            int,
  expect_cap_hours           int,               -- null = no ceiling
  expect_band                text    not null
) on commit drop;

insert into cap_vectors values
${rows.join(',\n')};

-- The count is generated too, so an empty or half-loaded table cannot pass.
\\set cap_vector_count ${vectors.cases.length}
`;
}

export function readVectors() {
  return JSON.parse(readFileSync(VECTORS_JSON, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rendered = renderCapVectors(readVectors());
  if (process.argv.includes('--check')) {
    const onDisk = readFileSync(VECTORS_PSQL, 'utf8');
    if (onDisk !== rendered) {
      console.error(
        'cap_vectors.psql is out of date — run: node supabase/tests/_shared/cap-vectors.mjs',
      );
      process.exit(1);
    }
    console.log('cap_vectors.psql is up to date');
  } else {
    writeFileSync(VECTORS_PSQL, rendered);
    console.log(`wrote ${VECTORS_PSQL} (${readVectors().cases.length} cases)`);
  }
}
